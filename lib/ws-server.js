/**
 * 插件本地 WebSocket 服务端（规格第二章 3 / 第四章 / 第七章 3）。
 *
 * 约束：
 * - 只监听 127.0.0.1，绝不绑定 0.0.0.0（`ss -ltn` 可证）。
 * - 握手鉴权：authSecret 非空时校验 upgrade 头 `x-lumegaze-auth`（恒定时间比较）；
 *   为空则不鉴权（Q2 冻结裁决）。
 * - 帧防护：`maxPayload` 限制超大帧；非法 JSON / 空 userId / 空 sessionId 一律
 *   回错误报文，服务不崩溃。
 * - 会话隔离：每个 sessionId 的出站报文都以当次入站的 sessionId / userId 回填。
 * - 开关隔离：chat / game_tick 先查 userId 开关，关闭时直接拦截，不调用引擎。
 */
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { getEngine } from './engine.js';
import { errorMessage } from './logger.js';
import { errorOutbound, makeOutbound, parseInboundText, serializeOutbound, sanitizeEngineResult, } from './protocol.js';
/** 单帧上限 256 KiB。 */
export const MAX_FRAME_BYTES = 256 * 1024;
function toText(data) {
    if (Array.isArray(data))
        return Buffer.concat(data).toString('utf8');
    if (data instanceof ArrayBuffer)
        return Buffer.from(data).toString('utf8');
    return data.toString('utf8');
}
function headerValue(headers, name) {
    const value = headers[name];
    if (Array.isArray(value))
        return value[0];
    return value;
}
/** 恒定时间比较；长度不等时先做一次自身比较再返回 false。 */
function safeEqual(a, b) {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
        timingSafeEqual(bufA, bufA);
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}
export class WsGateway {
    options;
    wss = null;
    clients = new Set();
    constructor(options) {
        this.options = options;
    }
    /** 启动服务。host 固定 127.0.0.1；端口非法时只记日志，不启动。 */
    start(port) {
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            this.options.logger.error('invalid wsPort=%s; gateway not started', port);
            return;
        }
        const wss = new WebSocketServer({
            host: '127.0.0.1',
            port,
            maxPayload: MAX_FRAME_BYTES,
            verifyClient: (info, cb) => {
                const secret = this.options.authSecret();
                if (!secret) {
                    cb(true);
                    return;
                }
                const provided = headerValue(info.req.headers, 'x-lumegaze-auth');
                if (provided === undefined) {
                    this.options.logger.connection('handshake rejected: missing x-lumegaze-auth');
                    cb(false, 401, 'Unauthorized');
                    return;
                }
                if (safeEqual(secret, provided)) {
                    cb(true);
                    return;
                }
                this.options.logger.connection('handshake rejected: invalid x-lumegaze-auth');
                cb(false, 401, 'Unauthorized');
            },
        });
        wss.on('connection', (socket, request) => this.onConnection(socket, request));
        wss.on('error', (error) => {
            this.options.logger.error('websocket server error: %s', errorMessage(error));
        });
        wss.on('close', () => {
            this.options.logger.connection('websocket server closed');
        });
        this.wss = wss;
    }
    /** 关闭服务并断开现有客户端；用于 ctx.effect 清理。 */
    async stop() {
        const wss = this.wss;
        this.wss = null;
        if (!wss)
            return;
        await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            };
            try {
                wss.close(finish);
            }
            catch {
                finish();
            }
            // 未成功 listen 等场景 close 回调可能不触发，兜底超时。
            setTimeout(finish, 1000).unref?.();
        });
        this.options.logger.connection('websocket gateway stopped');
    }
    get address() {
        return this.wss?.address() ?? null;
    }
    onConnection(socket, request) {
        this.clients.add(socket);
        const socket2 = request.socket;
        const peer = `${socket2?.remoteAddress ?? 'unknown'}:${socket2?.remotePort ?? 0}`;
        this.options.logger.connection('client connected (%s, clients=%d)', peer, this.clients.size);
        socket.on('message', (data, isBinary) => {
            if (isBinary) {
                this.send(socket, errorOutbound('', '', 'INVALID_MESSAGE', '不支持二进制帧'));
                return;
            }
            void this.handleFrame(socket, data);
        });
        socket.on('close', () => {
            this.clients.delete(socket);
            this.options.logger.connection('client disconnected (%s, clients=%d)', peer, this.clients.size);
        });
        socket.on('error', (error) => {
            this.options.logger.error('client socket error: %s', errorMessage(error));
        });
    }
    async handleFrame(socket, data) {
        let raw;
        try {
            raw = toText(data);
        }
        catch (error) {
            this.options.logger.error('frame decode failed: %s', errorMessage(error));
            this.send(socket, errorOutbound('', '', 'INVALID_MESSAGE', '无法解码帧内容'));
            return;
        }
        if (raw.length > MAX_FRAME_BYTES) {
            this.options.logger.connection('frame rejected: too large (%d chars)', raw.length);
            this.send(socket, errorOutbound('', '', 'PAYLOAD_TOO_LARGE', '帧超过大小上限'));
            return;
        }
        const parsed = parseInboundText(raw);
        if (!parsed.ok) {
            this.options.logger.connection('frame rejected: %s (%s)', parsed.errorCode, parsed.errorMsg);
            this.send(socket, errorOutbound('', '', parsed.errorCode, parsed.errorMsg));
            return;
        }
        const message = parsed.message;
        this.options.sessions.touch(message.sessionId, message.userId);
        try {
            if (message.type === 'toggle_walker_ai') {
                await this.handleToggle(socket, message);
            }
            else {
                await this.handleInference(socket, message);
            }
        }
        catch (error) {
            this.options.logger.error('frame handling failed for %s: %s', message.sessionId, errorMessage(error));
            this.send(socket, errorOutbound(message.sessionId, message.userId, 'INTERNAL_ERROR', '服务内部错误'));
        }
    }
    async handleToggle(socket, message) {
        const value = message.content;
        const previous = this.options.switches.isEnabled(message.userId);
        this.options.switches.set(message.userId, value);
        this.options.logger.switch('walker_ai switch %s: %s -> %s', message.userId, previous, value);
        const persisted = await this.options.switches.persist();
        if (!persisted) {
            this.options.logger.warn('walker_ai switch for %s not persisted', message.userId);
        }
        this.send(socket, makeOutbound({
            sessionId: message.sessionId,
            userId: message.userId,
            text: value ? '行者AI已开启' : '行者AI已关闭',
            emotion: 'normal',
            action: [],
            success: true,
            errorCode: '',
            errorMsg: '',
        }));
    }
    async handleInference(socket, message) {
        if (!this.options.switches.isEnabled(message.userId)) {
            this.options.logger.inference('walker_ai disabled for %s; request intercepted without engine call', message.userId);
            this.send(socket, errorOutbound(message.sessionId, message.userId, 'WALKER_AI_DISABLED', '行者AI能力未开启，请先打开开关'));
            return;
        }
        const engine = this.options.engine ? this.options.engine() : getEngine();
        let result;
        try {
            result = await engine.chat({
                sessionId: message.sessionId,
                userId: message.userId,
                content: message.content,
                type: message.type,
            });
        }
        catch (error) {
            this.options.logger.error('engine.chat threw for %s: %s', message.sessionId, errorMessage(error));
            this.send(socket, errorOutbound(message.sessionId, message.userId, 'ENGINE_ERROR', 'AI推理引擎调用失败'));
            return;
        }
        const safe = sanitizeEngineResult(result);
        this.options.logger.inference('session %s %s -> success=%s emotion=%s', message.sessionId, message.type, safe.success, safe.emotion);
        this.send(socket, makeOutbound({
            sessionId: message.sessionId,
            userId: message.userId,
            text: safe.text,
            emotion: safe.emotion,
            action: safe.action,
            success: safe.success,
            errorCode: safe.errorCode,
            errorMsg: safe.errorMsg,
        }));
    }
    send(socket, message) {
        if (socket.readyState !== socket.OPEN)
            return;
        try {
            socket.send(serializeOutbound(message));
        }
        catch (error) {
            this.options.logger.error('send failed: %s', errorMessage(error));
        }
    }
}
//# sourceMappingURL=ws-server.js.map