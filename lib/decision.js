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
export const ACTION_TYPES = [
    'wait',
    'move',
    'collect',
    'craft',
    'give',
    'discard',
    'trade_propose',
    'ally_propose',
    'rescue',
    'attack',
    'place_stele',
    'say',
];
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
/**
 * 去掉模型常见的 Markdown 代码围栏（```json ... ```）。
 * 只剥围栏，不做括号配平 / 截断修补。
 */
export function stripCodeFence(raw) {
    let text = raw.trim();
    if (!text.startsWith('```'))
        return text;
    text = text.replace(/^```[a-zA-Z0-9_-]*\r?\n?/, '');
    const end = text.lastIndexOf('```');
    if (end >= 0)
        text = text.slice(0, end);
    return text.trim();
}
/** 提取文本中第一个 `{ ... }` 片段（兜底修复用）。 */
export function extractJsonCandidate(text) {
    const start = text.indexOf('{');
    if (start < 0)
        return text;
    const end = text.lastIndexOf('}');
    if (end <= start)
        return text;
    return text.slice(start, end + 1);
}
/**
 * 补全括号：扫描字符串外的 `{` / `}` 计数，追加缺失的 `}`。
 * 仅做末尾补全，不改动字符串内部内容。
 */
export function balanceJson(text) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (const char of text) {
        if (inString) {
            if (escaped)
                escaped = false;
            else if (char === '\\')
                escaped = true;
            else if (char === '"')
                inString = false;
            continue;
        }
        if (char === '"')
            inString = true;
        else if (char === '{')
            depth += 1;
        else if (char === '}')
            depth -= 1;
    }
    return depth > 0 ? text + '}'.repeat(depth) : text;
}
/**
 * 多路兜底解析：直接 parse → 剥围栏 → 提取首个 {...} → 补全括号。
 * 全部失败返回 undefined（不抛错）。
 */
export function parseJsonLoose(raw) {
    const trimmed = raw.trim();
    const attempts = [];
    const push = (candidate) => {
        if (typeof candidate === 'string' && candidate.length > 0 && !attempts.includes(candidate)) {
            attempts.push(candidate);
        }
    };
    push(trimmed);
    const fenced = stripCodeFence(trimmed);
    push(fenced);
    const extracted = extractJsonCandidate(fenced);
    push(extracted);
    push(balanceJson(extracted));
    for (const candidate of attempts) {
        try {
            return JSON.parse(candidate);
        }
        catch {
            // 换下一路兜底
        }
    }
    return undefined;
}
function normalizeAction(rawAction) {
    if (!isPlainObject(rawAction)) {
        return { code: 'invalid_action', reason: 'action 必须是 JSON 对象' };
    }
    const type = rawAction.type;
    if (typeof type !== 'string' || !ACTION_TYPES.includes(type)) {
        return {
            code: 'invalid_action_type',
            reason: `action.type 不在服务端白名单内：${JSON.stringify(type ?? null)}`,
        };
    }
    const action = { type: type };
    if (rawAction.target !== undefined) {
        if (typeof rawAction.target === 'string') {
            action.target = rawAction.target;
        }
        else {
            return { code: 'invalid_target', reason: 'action.target 必须是字符串或省略' };
        }
    }
    if (rawAction.give !== undefined) {
        if (!isStringArray(rawAction.give)) {
            return { code: 'invalid_give', reason: 'action.give 必须是字符串数组或省略' };
        }
        action.give = [...rawAction.give];
    }
    if (rawAction.want !== undefined) {
        if (!isStringArray(rawAction.want)) {
            return { code: 'invalid_want', reason: 'action.want 必须是字符串数组或省略' };
        }
        action.want = [...rawAction.want];
    }
    if (rawAction.extra !== undefined) {
        if (!isPlainObject(rawAction.extra)) {
            return { code: 'invalid_extra', reason: 'action.extra 必须是对象或省略' };
        }
        action.extra = { ...rawAction.extra };
    }
    return { action };
}
/**
 * 校验已解析的对象（不做 JSON.parse）。
 * 非法结构一律返回 `ok:false`，绝不抛出。
 */
export function validateDecisionObject(parsed) {
    const raw = typeof parsed === 'string' ? parsed : '';
    if (!isPlainObject(parsed)) {
        return { ok: false, code: 'not_object', reason: 'LLM 输出必须是 JSON 对象', raw };
    }
    if (!('thought' in parsed)) {
        return { ok: false, code: 'missing_thought', reason: '缺少 thought 字段', raw };
    }
    if (typeof parsed.thought !== 'string') {
        return { ok: false, code: 'invalid_thought', reason: 'thought 必须是字符串', raw };
    }
    if (!('action' in parsed)) {
        return { ok: false, code: 'missing_action', reason: '缺少 action 字段', raw };
    }
    const { action, code, reason } = normalizeAction(parsed.action);
    if (!action) {
        return { ok: false, code: code ?? 'invalid_action', reason: reason ?? 'action 非法', raw };
    }
    const replyOwner = parsed.reply_owner === undefined ? '' : parsed.reply_owner;
    if (typeof replyOwner !== 'string') {
        return { ok: false, code: 'invalid_reply', reason: 'reply_owner 必须是字符串或省略', raw };
    }
    const replyOther = parsed.reply_other === undefined ? '' : parsed.reply_other;
    if (typeof replyOther !== 'string') {
        return { ok: false, code: 'invalid_reply', reason: 'reply_other 必须是字符串或省略', raw };
    }
    return {
        ok: true,
        raw,
        decision: {
            thought: parsed.thought,
            action,
            reply_owner: replyOwner,
            reply_other: replyOther,
        },
    };
}
/**
 * 解析 LLM 原始输出：先多路兜底 JSON.parse，再强校验决策结构。
 * 失败返回 `ok:false` 与明确原因，绝不抛错。
 */
export function parseDecision(raw) {
    const text = typeof raw === 'string' ? raw : '';
    if (text.trim().length === 0) {
        return { ok: false, code: 'invalid_json', reason: 'LLM 输出为空', raw: text };
    }
    const parsed = parseJsonLoose(text);
    if (parsed === undefined) {
        return { ok: false, code: 'invalid_json', reason: 'LLM 输出不是合法 JSON（兜底修复后仍失败）', raw: text };
    }
    return validateDecisionObject(parsed);
}
const EMOTION_KEYWORDS = [
    ['happy', ['高兴', '开心', '兴奋', '哈哈', '太好了', '雀跃']],
    ['sad', ['伤心', '难过', '悲伤', '哭', '沮丧', '失落']],
    ['shy', ['害羞', '脸红', '不好意思', '羞涩']],
    ['angry', ['生气', '愤怒', '可恶', '哼', '恼火']],
    ['calm', ['平静', '淡定', '安心', '从容']],
];
/**
 * 从思考 / 回复文本粗粒度推断 emotion（决策结构本身不含 emotion）。
 * 未命中任何关键词时返回 'normal'。
 */
export function deriveEmotion(...texts) {
    const haystack = texts.filter((text) => typeof text === 'string' && text.length > 0).join('\n');
    for (const [emotion, keywords] of EMOTION_KEYWORDS) {
        if (keywords.some((keyword) => haystack.includes(keyword)))
            return emotion;
    }
    return 'normal';
}
/**
 * 出站 `text` 取值：优先给观者的回复，其次给其他行者的对话，再退化为思考内容 /
 * 原始文本。返回值始终来自 durable assistant 消息（调用方传入 raw 兜底）。
 */
export function decisionReplyText(decision, raw) {
    const replyOwner = decision.reply_owner.trim();
    if (replyOwner.length > 0)
        return replyOwner;
    const replyOther = decision.reply_other.trim();
    if (replyOther.length > 0)
        return replyOther;
    const thought = decision.thought.trim();
    if (thought.length > 0)
        return thought;
    return raw.trim();
}
//# sourceMappingURL=decision.js.map