/**
 * 第四章通信协议：入站 / 出站报文的类型、编解码与强校验。
 *
 * 设计约束：
 * - Q1 裁决：报文保留规格字段，不增删字段。入站
 *   `{sessionId,userId,type,content,timestamp}`，出站
 *   `{sessionId,userId,text,emotion,action,success,errorCode,errorMsg}`。
 * - 任何来自网络或 AI 引擎的非法结构都要被拦截/兜底，绝不抛出到 WS 层导致断连。
 * - 本模块不依赖 ws / engine，可独立单测。
 */
/** emotion 枚举（规格第四章）。 */
export declare const EMOTIONS: readonly ["normal", "happy", "sad", "shy", "angry", "calm"];
export type Emotion = (typeof EMOTIONS)[number];
/** 入站 type 枚举（规格第四章）。 */
export declare const INBOUND_TYPES: readonly ["chat", "game_tick", "toggle_walker_ai"];
export type InboundType = (typeof INBOUND_TYPES)[number];
/** 规格错误码 + 协议层错误码。 */
export type ErrorCode = 'INVALID_JSON' | 'INVALID_MESSAGE' | 'UNSUPPORTED_TYPE' | 'PAYLOAD_TOO_LARGE' | 'WALKER_AI_DISABLED' | 'ENGINE_NOT_READY' | 'ENGINE_ERROR' | 'INTERNAL_ERROR';
/** 入站报文（规格第四章 4.1）。 */
export interface InboundMessage {
    sessionId: string;
    userId: string;
    type: InboundType;
    content: unknown;
    timestamp: number;
}
/** 出站报文（规格第四章 4.2）。 */
export interface OutboundMessage {
    sessionId: string;
    userId: string;
    text: string;
    emotion: Emotion;
    action: string[];
    success: boolean;
    errorCode: string;
    errorMsg: string;
}
/** AI 引擎返回结果经过强校验后的形状。 */
export interface EngineResult {
    text: string;
    emotion: Emotion;
    action: string[];
    success: boolean;
    errorCode: string;
    errorMsg: string;
}
export interface InboundParseSuccess {
    ok: true;
    message: InboundMessage;
}
export interface InboundParseFailure {
    ok: false;
    errorCode: ErrorCode;
    errorMsg: string;
}
export type InboundParseResult = InboundParseSuccess | InboundParseFailure;
/** 从文本帧解析入站报文；非法 JSON 返回 INVALID_JSON。 */
export declare function parseInboundText(raw: string, now?: number): InboundParseResult;
/** 校验并归一化一个已解析的入站对象。 */
export declare function parseInbound(value: unknown, now?: number): InboundParseResult;
/** 强校验 AI 引擎输出：非法结构一律兜底为 normal/空数组/false，绝不抛错。 */
export declare function sanitizeEngineResult(value: unknown): EngineResult;
/** 构造成功/任意出站报文。 */
export declare function makeOutbound(input: {
    sessionId: string;
    userId: string;
    text?: unknown;
    emotion?: unknown;
    action?: unknown;
    success: boolean;
    errorCode?: unknown;
    errorMsg?: unknown;
}): OutboundMessage;
/** 构造失败出站报文（规格 4.2 错误样例）。 */
export declare function errorOutbound(sessionId: string, userId: string, errorCode: string, errorMsg: string): OutboundMessage;
/** 序列化出站报文。 */
export declare function serializeOutbound(message: OutboundMessage): string;
//# sourceMappingURL=protocol.d.ts.map