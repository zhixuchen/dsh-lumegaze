import type { Context } from '@deepseek-ai/cordis'
import { Config, readVolatile, SETTINGS_NAMESPACE, type Config as LumegazeConfig } from './config.js'
import { errorMessage, LumegazeLogger } from './logger.js'
import { setEngine } from './engine.js'
import { createAgentEngine, type AgentEngineHandle } from './agent-engine.js'
import type { BillionDependencyInfo, MemoryMode } from './billion-context.js'
import { SessionRegistry } from './sessions.js'
import { WalkerSwitches } from './switches.js'
import { WsGateway } from './ws-server.js'

/** 插件显示名（fiber 日志 / Loader 诊断）。 */
export const name = 'dsh-lumegaze'

/**
 * 宿主侧所需 Cordis 服务。
 *
 * 仍保持为空：S2 的 WS 服务与日志只依赖 core（logger / fiber / effect）；
 * `ctx.settings` 通过 `ctx.reflect.get('settings')` 可选访问——存在则持久化开关，
 * 不存在则降级为内存态并记依赖日志，插件绝不因此加载失败（规格第三章降级规则）。
 * S3 接入 Agent 推理时再按需加入 `agents` / `pluginManager`（见 DSH peer 声明）。
 */
export const inject: string[] = []

export { Config, SETTINGS_NAMESPACE }

/** S3 Agent 引擎接缝：setEngine / getEngine / unavailableEngine。 */
export {
  ENGINE_NOT_READY,
  getEngine,
  resetEngine,
  setEngine,
  unavailableEngine,
  type EngineChatInput,
  type EngineChatResult,
  type LumegazeEngine,
} from './engine.js'

export { MAX_FRAME_BYTES } from './ws-server.js'

/** S3：决策结构强校验 / 兜底修复（供面板与测试复用）。 */
export {
  ACTION_TYPES,
  balanceJson,
  deriveEmotion,
  decisionReplyText,
  extractJsonCandidate,
  parseDecision,
  parseJsonLoose,
  stripCodeFence,
  validateDecisionObject,
  type ActionType,
  type Decision,
  type DecisionParseResult,
} from './decision.js'

/** S3：billion-context 依赖状态类型（供 S4 面板展示）。 */
export type { BillionDependencyInfo, BillionDependencyStatus, MemoryMode } from './billion-context.js'

/** S3：引擎句柄与依赖状态只读访问（S4 面板展示用）。 */
export type { AgentEngineHandle } from './agent-engine.js'

/** 当前 apply() 创建的引擎（模块级单实例；fiber dispose 时清空）。 */
let activeEngine: AgentEngineHandle | undefined

/** 当前 apply() 创建的开关表（模块级单实例；fiber dispose 时清空）。 */
let activeSwitches: WalkerSwitches | undefined

/** 供 S4 面板读取的依赖状态（未初始化时返回 unknown）。 */
export function getDependencyStatus(): BillionDependencyInfo {
  return activeEngine?.getDependencyStatus() ?? {
    status: 'unknown',
    installed: false,
    enabled: false,
    message: '引擎尚未初始化',
  }
}

/** 供 S4 面板读取的记忆模式（未初始化时保守降级为 short）。 */
export function getMemoryMode(): MemoryMode {
  return activeEngine?.getMemoryMode() ?? 'short'
}

/** 供 S4 面板读取的用户开关表（未初始化时返回空表）。 */
export function getSwitches(): Record<string, boolean> {
  return activeSwitches?.snapshot() ?? {}
}

/** `ctx.settings` 持久化所需的最小形状（避免强依赖 dsh-settings 类型）。 */
interface SettingsDescriptorLike {
  ns: string
  revision: number
}
interface SettingsFormsLike {
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptorLike[]
  mutate(
    ns: string,
    ops: readonly { op: 'set'; path: readonly string[]; value: unknown }[],
    expectedRevision?: number,
  ): Promise<void>
  configure?(presentation: { auto?: boolean }, owner?: unknown): () => void
}

/** 可选读取 settings 服务；未注入 / 形状不符时返回 undefined（不抛错）。 */
function resolveSettings(ctx: Context): SettingsFormsLike | undefined {
  try {
    const service = ctx.reflect.get('settings') as SettingsFormsLike | undefined
    if (service && typeof service.describe === 'function' && typeof service.mutate === 'function') {
      return service
    }
    return undefined
  } catch {
    return undefined
  }
}

/** 构造开关持久化回调：整表写回 volatile 字段 walkerAiSwitches。 */
function createPersistSwitches(
  ctx: Context,
  logger: LumegazeLogger,
): (snapshot: Record<string, boolean>) => Promise<boolean> {
  return async (snapshot: Record<string, boolean>): Promise<boolean> => {
    const settings = resolveSettings(ctx)
    if (!settings) {
      logger.dependency('settings service unavailable; walkerAiSwitches persistence skipped')
      return false
    }
    try {
      const rows = settings.describe({ redactSecrets: true })
      const row = rows.find((item) => item.ns === SETTINGS_NAMESPACE)
      await settings.mutate(
        SETTINGS_NAMESPACE,
        [{ op: 'set', path: ['walkerAiSwitches'], value: snapshot }],
        row?.revision,
      )
      return true
    } catch (error) {
      logger.server('persist walkerAiSwitches failed: %s', errorMessage(error))
      return false
    }
  }
}

/**
 * 把运行期状态（记忆模式 / billion-context 依赖状态）发布进本插件的 settings
 * 文档。浏览器半无法直接 import host 函数（客户端 bundle 纯净性门禁），因此
 * 经 `configForms` 读取这些 volatile 字段；仅在取值变化时写回，避免无谓 revision。
 */
async function publishRuntimeStatus(
  ctx: Context,
  config: LumegazeConfig,
  logger: LumegazeLogger,
  engine: AgentEngineHandle,
): Promise<void> {
  const settings = resolveSettings(ctx)
  if (!settings) return

  const memoryMode = engine.getMemoryMode()
  const dependency = engine.getDependencyStatus()
  const ops: Array<{ op: 'set'; path: readonly string[]; value: unknown }> = []
  if (readVolatile(config.memoryMode) !== memoryMode) {
    ops.push({ op: 'set', path: ['memoryMode'], value: memoryMode })
  }
  if (readVolatile(config.billionStatus) !== dependency.status) {
    ops.push({ op: 'set', path: ['billionStatus'], value: dependency.status })
  }
  if (ops.length === 0) return

  try {
    const rows = settings.describe({ redactSecrets: true })
    const row = rows.find((item) => item.ns === SETTINGS_NAMESPACE)
    await settings.mutate(SETTINGS_NAMESPACE, ops, row?.revision)
  } catch (error) {
    logger.warn('runtime status publish failed: %s', errorMessage(error))
  }
}

/**
 * M1：订阅 Loader 的 volatile-only 配置提交事件。
 *
 * `@deepseek-ai/cordis-plugin-loader` 的 `_commitVolatile()` 在 volatile 值变化时
 * 以 `fiber.ctx.emit(self, "loader/volatile-update", paths)` 向所属 fiber 派发
 * `paths`（路径数组的数组，如 `[['enabled']]`）。事件名由 loader 包通过声明合并
 * 注入 `Events`；本插件不在编译期依赖 loader 包，因此用最小事件形状断言注册，
 * 避免为类型引入未声明的 peer 依赖。
 */
function onLoaderVolatileUpdate(ctx: Context, listener: (paths: unknown) => void): () => void {
  return (ctx.on as unknown as (event: string, listener: (...args: unknown[]) => void) => () => void)(
    'loader/volatile-update',
    listener,
  )
}

/**
 * 插件入口。
 *
 * 遵循 DSH/cordis 真实生命周期（D1）：不存在 install/enable/disable/uninstall
 * 钩子，这里只做同步初始化，所有资源清理通过 `ctx.effect` 注册（Agent dispose、
 * wss.close()、开关 / 会话表清理），fiber dispose 时由 cordis 逆序调用 disposer。
 * 不 await 任何安装/网络调用：billion-context 的检测/安装放在独立异步 effect 中
 * fire-and-forget 触发，插件绝不自我重载。
 */
export function apply(ctx: Context, config: LumegazeConfig): void {
  const logger = ctx.logger(name)
  const llogger = new LumegazeLogger({
    base: logger,
    isDetailed: () => readVolatile(config.logEnabled) === true,
    secrets: () => {
      const secret = readVolatile(config.authSecret)
      return secret ? [secret] : []
    },
  })

  const switches = new WalkerSwitches(readVolatile(config.walkerAiSwitches))
  switches.setPersist(createPersistSwitches(ctx, llogger))
  activeSwitches = switches
  const sessions = new SessionRegistry()
  const gateway = new WsGateway({
    switches,
    sessions,
    logger: llogger,
    authSecret: () => readVolatile(config.authSecret),
    // M1：面板「插件总开关」为运行期功能开关，读 volatile enabled。
    isEnabled: () => readVolatile(config.enabled) === true,
  })

  // S3 注入 DSH 原生 Agent 推理引擎（S2 预留的 setEngine 接缝）。
  const engine = createAgentEngine(ctx, config, { logger: llogger })
  activeEngine = engine
  setEngine(engine)

  ctx.effect(
    () => {
      const port = readVolatile(config.wsPort)
      // M1：enabled 为 false 时不启动 WS 网关；若网关已在运行期被关闭，
      // ws-server 会在每帧拦截 chat / game_tick 并回 PLUGIN_DISABLED。
      if (readVolatile(config.enabled) === true) {
        gateway.start(port)
      } else {
        llogger.dependency('plugin master switch disabled; websocket gateway not started')
      }
      // M1：运行期 enabled 翻转时同步启停 WS 网关。
      // Loader 在 volatile-only 变更时提交引用并派发 loader/volatile-update；
      // 这里只处理 enabled 路径，其他 volatile 字段变化不影响网关生命周期。
      let volatileUpdateDisposer: (() => void) | undefined
      try {
        volatileUpdateDisposer = onLoaderVolatileUpdate(ctx, (paths) => {
          const enabledChanged = Array.isArray(paths)
            && paths.some((entry) => Array.isArray(entry) && (entry as string[]).includes('enabled'))
          if (!enabledChanged) return
          if (readVolatile(config.enabled) === true) {
            if (!gateway.isRunning()) {
              gateway.start(readVolatile(config.wsPort))
            }
          } else {
            // S-4：enabled=false 时无条件请求 stop（即使 isRunning() 因关闭窗口为 false），
            // 以取消关闭窗口内记录的延迟 start。
            void gateway.stop()
          }
        })
      } catch (error) {
        llogger.warn('volatile-update listener registration failed: %s', errorMessage(error))
      }
      llogger.dependency('settings service available: %s', resolveSettings(ctx) !== undefined)
      llogger.server('serverUrl configured: %s', readVolatile(config.serverUrl).length > 0)
      // 本插件自带 plugins.item 自定义面板；关闭自动生成表单，避免运行态状态字段
      // （memoryMode / billionStatus）被当作可编辑项暴露。
      let configureDisposer: (() => void) | undefined
      try {
        configureDisposer = resolveSettings(ctx)?.configure?.({ auto: false })
      } catch (error) {
        llogger.warn('settings auto page policy failed: %s', errorMessage(error))
      }
      // billion-context 检测/安装：独立异步 effect，apply 同步体不 await；
      // 绝不卸载/修改 billion-context，安装失败只告警并短期降级。
      // 安装/检测结束后把运行态状态发布进 settings 文档供浏览器面板读取。
      void engine
        .ensureBillionInstalled()
        .then(() => publishRuntimeStatus(ctx, config, llogger, engine))
        .catch((error: unknown) => {
          llogger.warn('billion-context detached install failed: %s', errorMessage(error))
        })
      logger.info(
        'lumegaze runtime initialized (host=127.0.0.1, wsPort=%s, logEnabled=%s)',
        port,
        readVolatile(config.logEnabled),
      )
      return async () => {
        // 显式移除 volatile-update 监听（ctx.on 已随 fiber 自动清理，显式更安全）。
        // S-3：disposer 可能非函数（bail 拦截时 ctx.on 返回 truthy 非函数），调用前判断。
        if (typeof volatileUpdateDisposer === 'function') volatileUpdateDisposer()
        if (typeof configureDisposer === 'function') configureDisposer()
        await engine.dispose()
        // S-4：fiber dispose 走 gateway.dispose()，关闭窗口内不再响应延迟 start。
        await gateway.dispose()
        switches.clear()
        sessions.clear()
        activeEngine = undefined
        activeSwitches = undefined
        logger.info('lumegaze runtime disposed')
      }
    },
    'lumegaze: runtime',
  )
}
