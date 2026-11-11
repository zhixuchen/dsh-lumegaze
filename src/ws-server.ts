/**
 * 插件本地 WebSocket 服务端（规格第二章 3 / 第四章 / 第七章 3）。
 *
 * 约束：
 * - 只监听 127.0.0.1，绝不绑定 0.0.0.0（`ss -ltn` 可证）。
 * - 握手鉴权：authSecret 非空时校验两种承载——upgrade 头 `x-lumegaze-auth` 或
 *   URL 查询参数 `?token=`（浏览器 / Tauri WebView 的 `WebSocket` 无法自定义
 *   upgrade 头，故需 query 承载）；两者均做恒定时间比较，任一正确即放行，
 *   都缺失/错误则 401。为空则不鉴权（Q2 冻结裁决，向后兼容）。
 * - 帧防护：`maxPayload` 限制超大帧；非法 JSON / 空 userId / 空 sessionId 一律
 *   回错误报文，服务不崩溃。
 * - 会话隔离：每个 sessionId 的出站报文都以当次入站的 sessionId / userId 回填。
 * - 开关隔离：chat / game_tick 先查 userId 开关，关闭时直接拦截，不调用引擎。
 */

import { timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { WebSocketServer, type WebSocket, type RawData } from 'ws'
import { getEngine, type LumegazeEngine } from './engine.js'
import { errorMessage, type LumegazeLogger } from './logger.js'
import {
  errorOutbound,
  makeOutbound,
  parseInboundText,
  serializeOutbound,
  sanitizeEngineResult,
  type InboundMessage,
  type OutboundMessage,
} from './protocol.js'
import type { SessionRegistry } from './sessions.js'
import type { WalkerSwitches } from './switches.js'

/** 单帧上限 256 KiB。 */
export const MAX_FRAME_BYTES = 256 * 1024

export interface WsGatewayOptions {
  switches: WalkerSwitches
  sessions: SessionRegistry
  logger: LumegazeLogger
  authSecret: () => string
  /**
   * 插件总开关的运行期判定（M1）：为 false 时 chat / game_tick 一律回
   * `PLUGIN_DISABLED` 且不调用引擎。缺省视为开启（保持向后兼容）。
   */
  isEnabled?: () => boolean
  /** 引擎解析器；缺省用模块级槽位 getEngine()。 */
  engine?: () => LumegazeEngine
}

function toText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  if (Array.isArray(value)) return value[0]
  return value
}

/**
 * 读取 upgrade 请求 URL 中的 `?token=` / `&token=` 参数（浏览器 / WebView 承载）。
 *
 * 客户端以 `encodeURIComponent(token)` 编码，这里解码回原文再比较；解码失败
 * （畸形百分号序列）时退回原始片段，仍交由恒定时间比较判定，不抛错、不泄露。
 */
export function readQueryToken(url: string | undefined): string | undefined {
  if (!url) return undefined
  const match = /[?&]token=([^&]*)/.exec(url)
  if (!match) return undefined
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

/** 恒定时间比较；长度不等时先做一次自身比较再返回 false。 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export class WsGateway {
  private wss: WebSocketServer | null = null
  private readonly clients = new Set<WebSocket>()
  /**
   * S-4：stop() 关闭窗口标志。窗口内 `wss` 已置空但旧实例尚未 close 完成，
   * `start()` 必须延后，避免旧实例关闭与新实例并存。
   */
  private closing = false
  /** 关闭窗口内收到的 start 端口；stop() 完成后补启。 */
  private pendingStartPort: number | undefined
  /** 进行中的 stop() 句柄：重复 stop 幂等。 */
  private stopPromise: Promise<void> | undefined
  /** fiber dispose 后置 true：停止后不再补启延迟 start。 */
  private disposed = false

  constructor(private readonly options: WsGatewayOptions) {}

  /** 启动服务。host 固定 127.0.0.1；已在运行时忽略，端口非法时只记日志，不启动。 */
  start(port: number): void {
    // S-4：dispose 后网关不可复活——dispose() 已置 disposed，此处直接拒绝，
    // 避免 dispose 后的生命周期里再次监听端口 / 新建实例。
    if (this.disposed) {
      this.options.logger.warn('websocket gateway disposed; ignore start(port=%s)', port)
      return
    }
    if (this.wss) {
      this.options.logger.warn('websocket gateway already running; ignore start(port=%s)', port)
      return
    }
    if (this.closing) {
      // S-4：关闭窗口内不新建实例，记录端口待 stop() 完成后补启。
      this.pendingStartPort = port
      this.options.logger.warn('websocket gateway is closing; defer start(port=%s)', port)
      return
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      this.options.logger.error('invalid wsPort=%s; gateway not started', port)
      return
    }

    const wss = new WebSocketServer({
      host: '127.0.0.1',
      port,
      maxPayload: MAX_FRAME_BYTES,
      verifyClient: (info, cb) => {
        const secret = this.options.authSecret()
        if (!secret) {
          cb(true)
          return
        }
        const headerToken = headerValue(info.req.headers, 'x-lumegaze-auth')
        const queryToken = readQueryToken(info.req.url)
        // 两种承载任一正确即放行；两者都缺失/错误则 401。
        const headerOk = headerToken !== undefined && safeEqual(secret, headerToken)
        const queryOk = queryToken !== undefined && safeEqual(secret, queryToken)
        if (headerOk || queryOk) {
          cb(true)
          return
        }
        if (headerToken === undefined && queryToken === undefined) {
          this.options.logger.connection('handshake rejected: missing x-lumegaze-auth header and token query')
        } else {
          this.options.logger.connection('handshake rejected: invalid x-lumegaze-auth header or token query')
        }
        cb(false, 401, 'Unauthorized')
      },
    })

    wss.on('connection', (socket: WebSocket, request: IncomingMessage) => this.onConnection(socket, request))
    wss.on('error', (error: Error) => {
      this.options.logger.error('websocket server error: %s', errorMessage(error))
    })
    wss.on('close', () => {
      this.options.logger.connection('websocket server closed')
    })

    this.wss = wss
  }

  /**
   * 关闭服务并断开现有客户端；用于运行期停用。
   *
   * S-4：置 `closing` 标志；窗口内到达的 `start()` 只记录端口，待关闭完成后补启。
   * 重复调用返回同一个进行中的 stop，保证幂等。
   */
  async stop(): Promise<void> {
    if (this.stopPromise) {
      // 已在关闭中：新的意图是停，取消待补启的 start。
      this.pendingStartPort = undefined
      return this.stopPromise
    }
    this.closing = true
    const wss = this.wss
    this.wss = null
    this.stopPromise = (async () => {
      if (!wss) return
      await new Promise<void>((resolve) => {
        let settled = false
        const finish = (): void => {
          if (!settled) {
            settled = true
            resolve()
          }
        }
        try {
          wss.close(finish)
        } catch {
          finish()
        }
        // 未成功 listen 等场景 close 回调可能不触发，兜底超时。
        setTimeout(finish, 1000).unref?.()
      })
    })()
    try {
      await this.stopPromise
    } finally {
      this.stopPromise = undefined
      this.closing = false
    }
    this.options.logger.connection('websocket gateway stopped')
    this.flushPendingStart()
  }

  /**
   * fiber dispose 路径：停止网关且不再补启关闭窗口内记录的延迟 start。
   * 与 {@link stop} 的区别只在 `disposed` 标志。
   */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.stop()
  }

  /** stop() 完成后补启关闭窗口内记录的 start（dispose 后不再补启）。 */
  private flushPendingStart(): void {
    if (this.disposed) return
    if (this.pendingStartPort === undefined) return
    const port = this.pendingStartPort
    this.pendingStartPort = undefined
    this.start(port)
  }

  get address(): ReturnType<WebSocketServer['address']> | null {
    return this.wss?.address() ?? null
  }

  /** M1：网关是否处于运行态（start 成功且尚未 stop），供运行期启停判定。 */
  isRunning(): boolean {
    return this.wss !== null
  }

  /** S-4：是否处于 stop() 关闭窗口（wss 已置空、旧实例尚未 close 完成）。 */
  isClosing(): boolean {
    return this.closing
  }

  private onConnection(socket: WebSocket, request: IncomingMessage): void {
    this.clients.add(socket)
    const socket2 = request.socket
    const peer = `${socket2?.remoteAddress ?? 'unknown'}:${socket2?.remotePort ?? 0}`
    this.options.logger.connection('client connected (%s, clients=%d)', peer, this.clients.size)

    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        this.send(socket, errorOutbound('', '', 'INVALID_MESSAGE', '不支持二进制帧'))
        return
      }
      void this.handleFrame(socket, data)
    })

    socket.on('close', () => {
      this.clients.delete(socket)
      this.options.logger.connection('client disconnected (%s, clients=%d)', peer, this.clients.size)
    })

    socket.on('error', (error: Error) => {
      this.options.logger.error('client socket error: %s', errorMessage(error))
    })
  }

  private async handleFrame(socket: WebSocket, data: RawData): Promise<void> {
    let raw: string
    try {
      raw = toText(data)
    } catch (error) {
      this.options.logger.error('frame decode failed: %s', errorMessage(error))
      this.send(socket, errorOutbound('', '', 'INVALID_MESSAGE', '无法解码帧内容'))
      return
    }

    if (raw.length > MAX_FRAME_BYTES) {
      this.options.logger.connection('frame rejected: too large (%d chars)', raw.length)
      this.send(socket, errorOutbound('', '', 'PAYLOAD_TOO_LARGE', '帧超过大小上限'))
      return
    }

    const parsed = parseInboundText(raw)
    if (!parsed.ok) {
      this.options.logger.connection('frame rejected: %s (%s)', parsed.errorCode, parsed.errorMsg)
      this.send(socket, errorOutbound('', '', parsed.errorCode, parsed.errorMsg))
      return
    }

    const message = parsed.message
    this.options.sessions.touch(message.sessionId, message.userId)

    // M1：插件总开关是运行期功能开关——关闭时 chat / game_tick 直接拦截，
    // 不启动网关（apply 阶段）且不调用引擎；toggle 仍允许改配置。
    if (message.type !== 'toggle_walker_ai' && this.options.isEnabled?.() === false) {
      this.options.logger.inference(
        'plugin disabled by master switch; request intercepted without engine call (%s)',
        message.sessionId,
      )
      this.send(
        socket,
        errorOutbound(message.sessionId, message.userId, 'PLUGIN_DISABLED', '插件已禁用，请先在配置面板开启插件总开关'),
      )
      return
    }

    try {
      if (message.type === 'toggle_walker_ai') {
        await this.handleToggle(socket, message)
      } else {
        await this.handleInference(socket, message)
      }
    } catch (error) {
      this.options.logger.error('frame handling failed for %s: %s', message.sessionId, errorMessage(error))
      this.send(socket, errorOutbound(message.sessionId, message.userId, 'INTERNAL_ERROR', '服务内部错误'))
    }
  }

  private async handleToggle(socket: WebSocket, message: InboundMessage): Promise<void> {
    const value = message.content as boolean
    const previous = this.options.switches.isEnabled(message.userId)
    this.options.switches.set(message.userId, value)
    this.options.logger.switch('walker_ai switch %s: %s -> %s', message.userId, previous, value)

    const persisted = await this.options.switches.persist()
    if (!persisted) {
      this.options.logger.warn('walker_ai switch for %s not persisted', message.userId)
    }

    this.send(
      socket,
      makeOutbound({
        sessionId: message.sessionId,
        userId: message.userId,
        text: value ? '行者AI已开启' : '行者AI已关闭',
        emotion: 'normal',
        action: [],
        success: true,
        errorCode: '',
        errorMsg: '',
      }),
    )
  }

  private async handleInference(socket: WebSocket, message: InboundMessage): Promise<void> {
    if (!this.options.switches.isEnabled(message.userId)) {
      this.options.logger.inference(
        'walker_ai disabled for %s; request intercepted without engine call',
        message.userId,
      )
      this.send(
        socket,
        errorOutbound(message.sessionId, message.userId, 'WALKER_AI_DISABLED', '行者AI能力未开启，请先打开开关'),
      )
      return
    }

    const engine = this.options.engine ? this.options.engine() : getEngine()
    let result: unknown
    try {
      result = await engine.chat({
        sessionId: message.sessionId,
        userId: message.userId,
        content: message.content,
        type: message.type,
      })
    } catch (error) {
      this.options.logger.error('engine.chat threw for %s: %s', message.sessionId, errorMessage(error))
      this.send(socket, errorOutbound(message.sessionId, message.userId, 'ENGINE_ERROR', 'AI推理引擎调用失败'))
      return
    }

    // M2：超长 / 畸形 JSON 动作对象被丢弃时记日志（只记长度与原因，不落原文）。
    const reportActionDrop = (reason: string, item: string): void => {
      this.options.logger.warn(
        'session %s action dropped: %s (len=%d)',
        message.sessionId,
        reason,
        item.length,
      )
    }

    const safe = sanitizeEngineResult(result, { onDrop: reportActionDrop })
    this.options.logger.inference('session %s %s -> success=%s emotion=%s', message.sessionId, message.type, safe.success, safe.emotion)
    this.send(
      socket,
      makeOutbound(
        {
          sessionId: message.sessionId,
          userId: message.userId,
          text: safe.text,
          emotion: safe.emotion,
          action: safe.action,
          success: safe.success,
          errorCode: safe.errorCode,
          errorMsg: safe.errorMsg,
        },
        { onDrop: reportActionDrop },
      ),
    )
  }

  private send(socket: WebSocket, message: OutboundMessage): void {
    if (socket.readyState !== socket.OPEN) return
    try {
      socket.send(serializeOutbound(message))
    } catch (error) {
      this.options.logger.error('send failed: %s', errorMessage(error))
    }
  }
}
