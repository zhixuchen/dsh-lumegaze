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
export type ErrorCode = 'INVALID_JSON' | 'INVALID_MESSAGE' | 'UNSUPPORTED_TYPE' | 'PAYLOAD_TOO_LARGE' | 'WALKER_AI_DISABLED' | 'PLUGIN_DISABLED' | 'ENGINE_NOT_READY' | 'ENGINE_ERROR' | 'ACTION_TOO_LARGE' | 'INTERNAL_ERROR';
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
/** action 数组元素被丢弃的原因（仅用于日志 / 诊断，不改变出站协议）。 */
export type ActionDropReason = 'json_action_too_large' | 'malformed_json_action';
/** 丢弃回调签名（由调用方注入日志，缺省静默丢弃）。 */
export type ActionDropHandler = (reason: ActionDropReason, item: string) => void;
/**
 * 强校验 action 数组（规格第四章 + T9 完整动作对象）：
 * - 完整动作对象（`{...}` 且可解析为非数组对象）：长度 ≤ `MAX_JSON_ACTION_LENGTH`
 *   原样保留；超限整项**丢弃**并回调诊断，绝不截断成坏 JSON。
 * - 以 `{` 开头但无法解析为对象的字符串：直接丢弃（截断只会产出坏 JSON）。
 * - 裸动作类型字符串：保持既有 128 长度兜底截断（截断裸类型不破坏语义）。
 * - 任何分支最多保留 `MAX_ACTIONS` 项。
 */
export declare function sanitizeActions(value: unknown, onDrop?: ActionDropHandler): string[];
/** 消毒诊断（可选）：捕获 action 丢弃事件用于日志，不参与协议。 */
export interface SanitizeDiagnostics {
    onDrop?: ActionDropHandler;
}
/** 强校验 AI 引擎输出：非法结构一律兜底为 normal/空数组/false，绝不抛错。 */
export declare function sanitizeEngineResult(value: unknown, diagnostics?: SanitizeDiagnostics): EngineResult;
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
}, diagnostics?: SanitizeDiagnostics): OutboundMessage;
/** 构造失败出站报文（规格 4.2 错误样例）。 */
export declare function errorOutbound(sessionId: string, userId: string, errorCode: string, errorMsg: string): OutboundMessage;
/** 序列化出站报文。 */
export declare function serializeOutbound(message: OutboundMessage): string;
//# sourceMappingURL=protocol.d.ts.map