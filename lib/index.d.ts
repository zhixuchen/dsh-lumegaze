import type { Context } from '@deepseek-ai/cordis';
import { Config, SETTINGS_NAMESPACE, type Config as LumegazeConfig } from './config.js';
import type { BillionDependencyInfo, MemoryMode } from './billion-context.js';
/** 插件显示名（fiber 日志 / Loader 诊断）。 */
export declare const name = "dsh-lumegaze";
/**
 * 宿主侧所需 Cordis 服务。
 *
 * 仍保持为空：S2 的 WS 服务与日志只依赖 core（logger / fiber / effect）；
 * `ctx.settings` 通过 `ctx.reflect.get('settings')` 可选访问——存在则持久化开关，
 * 不存在则降级为内存态并记依赖日志，插件绝不因此加载失败（规格第三章降级规则）。
 * S3 接入 Agent 推理时再按需加入 `agents` / `pluginManager`（见 DSH peer 声明）。
 */
export declare const inject: string[];
export { Config, SETTINGS_NAMESPACE };
/** S3 Agent 引擎接缝：setEngine / getEngine / unavailableEngine。 */
export { ENGINE_NOT_READY, getEngine, resetEngine, setEngine, unavailableEngine, type EngineChatInput, type EngineChatResult, type LumegazeEngine, } from './engine.js';
export { MAX_FRAME_BYTES } from './ws-server.js';
/** S3：决策结构强校验 / 兜底修复（供面板与测试复用）。 */
export { ACTION_TYPES, balanceJson, deriveEmotion, decisionReplyText, extractJsonCandidate, parseDecision, parseJsonLoose, stripCodeFence, validateDecisionObject, type ActionType, type Decision, type DecisionParseResult, } from './decision.js';
/** S3：billion-context 依赖状态类型（供 S4 面板展示）。 */
export type { BillionDependencyInfo, BillionDependencyStatus, MemoryMode } from './billion-context.js';
/** S3：引擎句柄与依赖状态只读访问（S4 面板展示用）。 */
export type { AgentEngineHandle } from './agent-engine.js';
/** 供 S4 面板读取的依赖状态（未初始化时返回 unknown）。 */
export declare function getDependencyStatus(): BillionDependencyInfo;
/** 供 S4 面板读取的记忆模式（未初始化时保守降级为 short）。 */
export declare function getMemoryMode(): MemoryMode;
/** 供 S4 面板读取的用户开关表（未初始化时返回空表）。 */
export declare function getSwitches(): Record<string, boolean>;
/**
 * 插件入口。
 *
 * 遵循 DSH/cordis 真实生命周期（D1）：不存在 install/enable/disable/uninstall
 * 钩子，这里只做同步初始化，所有资源清理通过 `ctx.effect` 注册（Agent dispose、
 * wss.close()、开关 / 会话表清理），fiber dispose 时由 cordis 逆序调用 disposer。
 * 不 await 任何安装/网络调用：billion-context 的检测/安装放在独立异步 effect 中
 * fire-and-forget 触发，插件绝不自我重载。
 */
export declare function apply(ctx: Context, config: LumegazeConfig): void;
//# sourceMappingURL=index.d.ts.map