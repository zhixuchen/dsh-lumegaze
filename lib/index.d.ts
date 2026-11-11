import type { Context } from '@deepseek-ai/cordis';
import { Config, SETTINGS_NAMESPACE, type Config as LumegazeConfig } from './config.js';
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
/**
 * 插件入口。
 *
 * 遵循 DSH/cordis 真实生命周期（D1）：不存在 install/enable/disable/uninstall
 * 钩子，这里只做同步初始化，所有资源清理通过 `ctx.effect` 注册（wss.close()、
 * 开关 / 会话表清理），fiber dispose 时由 cordis 逆序调用 disposer。
 * 不 await 任何安装/网络调用；S3 的 Agent 推理与 billion-context 检测另行承载。
 */
export declare function apply(ctx: Context, config: LumegazeConfig): void;
//# sourceMappingURL=index.d.ts.map