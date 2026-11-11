/**
 * LLM 决策输出 JSON 强校验 + 兜底修复（规格第六章 5 / 第二章 7 / 第七章 5）。
 *
 * 与观灵域客户端 `client/src/agent/schema.ts` 的 `parseLlmDecision` 保持同一
 * 决策结构（thought / action{type,target,give,want,extra} / reply_owner /
 * reply_other），但本插件作为网关允许「兜底修复」后再映射，而客户端是直接丢弃。
 *
 * 铁律：
 * - 绝不把非法结构透传给客户端；解析/校验失败必须返回 `ok:false`，由引擎回
 *   `success:false,errorCode:"INVALID_LLM_OUTPUT"`。
 * - 本模块是纯函数，无副作用，可独立单测。
 */
/** 服务端动作白名单（12 项，规格第二章 / 观灵域 messages.ts）。 */
export declare const ACTION_TYPES: readonly ["wait", "move", "collect", "craft", "give", "discard", "trade_propose", "ally_propose", "rescue", "attack", "place_stele", "say"];
export type ActionType = (typeof ACTION_TYPES)[number];
/** 校验通过的决策（已归一化）。 */
export interface Decision {
    thought: string;
    action: {
        type: ActionType;
        target?: string;
        give?: string[];
        want?: string[];
        extra?: Record<string, unknown>;
    };
    reply_owner: string;
    reply_other: string;
}
export interface DecisionParseSuccess {
    ok: true;
    decision: Decision;
    /** LLM 原始输出（未修改），便于日志。 */
    raw: string;
}
export interface DecisionParseFailure {
    ok: false;
    /** 结构化的失败分类（便于日志与统计）。 */
    code: 'invalid_json' | 'not_object' | 'missing_thought' | 'invalid_thought' | 'missing_action' | 'invalid_action' | 'invalid_action_type' | 'invalid_target' | 'invalid_give' | 'invalid_want' | 'invalid_extra' | 'invalid_reply';
    reason: string;
    raw: string;
}
export type DecisionParseResult = DecisionParseSuccess | DecisionParseFailure;
/**
 * 去掉模型常见的 Markdown 代码围栏（```json ... ```）。
 * 只剥围栏，不做括号配平 / 截断修补。
 */
export declare function stripCodeFence(raw: string): string;
/** 提取文本中第一个 `{ ... }` 片段（兜底修复用）。 */
export declare function extractJsonCandidate(text: string): string;
/**
 * 补全括号：扫描字符串外的 `{` / `}` 计数，追加缺失的 `}`。
 * 仅做末尾补全，不改动字符串内部内容。
 */
export declare function balanceJson(text: string): string;
/**
 * 多路兜底解析：直接 parse → 剥围栏 → 提取首个 {...} → 补全括号。
 * 全部失败返回 undefined（不抛错）。
 */
export declare function parseJsonLoose(raw: string): unknown | undefined;
/**
 * 校验已解析的对象（不做 JSON.parse）。
 * 非法结构一律返回 `ok:false`，绝不抛出。
 */
export declare function validateDecisionObject(parsed: unknown): DecisionParseResult & {
    raw: string;
};
/**
 * 解析 LLM 原始输出：先多路兜底 JSON.parse，再强校验决策结构。
 * 失败返回 `ok:false` 与明确原因，绝不抛错。
 */
export declare function parseDecision(raw: string): DecisionParseResult;
/**
 * 从思考 / 回复文本粗粒度推断 emotion（决策结构本身不含 emotion）。
 * 未命中任何关键词时返回 'normal'。
 */
export declare function deriveEmotion(...texts: string[]): import('./protocol.js').Emotion;
/**
 * 出站 `text` 取值：优先给观者的回复，其次给其他行者的对话，再退化为思考内容 /
 * 原始文本。返回值始终来自 durable assistant 消息（调用方传入 raw 兜底）。
 */
export declare function decisionReplyText(decision: Decision, raw: string): string;
//# sourceMappingURL=decision.d.ts.map