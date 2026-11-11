/**
 * S3 Agent 引擎接缝（关键）。
 *
 * S2 只定义接口与默认占位实现，不实现任何真实 Agent 调用（那是 S3 范围）。
 * S3 通过 `setEngine(realEngine)` 无侵入注入；网关在每次 chat / game_tick 时
 * 经 `getEngine()` 取当前引擎，因此注入对运行中的服务即时生效。
 */
import type { Emotion, InboundType } from './protocol.js';
/** 传给引擎的单轮输入。 */
export interface EngineChatInput {
    sessionId: string;
    userId: string;
    content: unknown;
    type: InboundType;
}
/** 引擎单轮返回（规格第四章出站字段子集）。 */
export interface EngineChatResult {
    text: string;
    emotion: Emotion;
    action: string[];
    success: boolean;
    errorCode: string;
    errorMsg: string;
}
/**
 * 可插拔 AI 推理引擎接口。
 *
 * 契约：实现者必须返回 Promise；不得抛异常到网关层（网关仍会兜底捕获，
 * 但实现方应优先返回 `{success:false,errorCode,errorMsg}`）。
 */
export interface LumegazeEngine {
    chat(input: EngineChatInput): Promise<EngineChatResult>;
}
/** 默认未就绪引擎：明确返回 ENGINE_NOT_READY，绝不假装成功。 */
export declare const ENGINE_NOT_READY = "ENGINE_NOT_READY";
export declare const unavailableEngine: LumegazeEngine;
interface EngineSlot {
    current: LumegazeEngine;
}
/** 模块级可替换槽位：S3 用 `setEngine` 注入真实引擎。 */
export declare const engineSlot: EngineSlot;
/** 读取当前引擎（缺省永远是 unavailableEngine）。 */
export declare function getEngine(): LumegazeEngine;
/**
 * 注入 / 替换引擎，返回被替换掉的旧引擎（便于测试与回滚）。
 * 传入非法实现会抛 TypeError，避免把网关拖入坏状态。
 */
export declare function setEngine(engine: LumegazeEngine): LumegazeEngine;
/** 恢复默认占位引擎。 */
export declare function resetEngine(): LumegazeEngine;
export {};
//# sourceMappingURL=engine.d.ts.map