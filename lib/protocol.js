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
export const EMOTIONS = ['normal', 'happy', 'sad', 'shy', 'angry', 'calm'];
/** 入站 type 枚举（规格第四章）。 */
export const INBOUND_TYPES = ['chat', 'game_tick', 'toggle_walker_ai'];
const MAX_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 64 * 1024;
const MAX_ACTIONS = 16;
const MAX_ACTION_LENGTH = 128;
function fail(errorCode, errorMsg) {
    return { ok: false, errorCode, errorMsg };
}
function isNonEmptyBoundedString(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}
function isStructuredContent(value) {
    return typeof value === 'object' && value !== null;
}
function normalizeTimestamp(value, nowSeconds) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : nowSeconds;
}
/** 从文本帧解析入站报文；非法 JSON 返回 INVALID_JSON。 */
export function parseInboundText(raw, now = Date.now()) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return fail('INVALID_JSON', '非法 JSON 帧');
    }
    return parseInbound(parsed, now);
}
/** 校验并归一化一个已解析的入站对象。 */
export function parseInbound(value, now = Date.now()) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return fail('INVALID_MESSAGE', '报文必须是 JSON 对象');
    }
    const record = value;
    const { sessionId, userId, type, content } = record;
    if (!isNonEmptyBoundedString(sessionId)) {
        return fail('INVALID_MESSAGE', `sessionId 必须是非空字符串(≤${MAX_ID_LENGTH})`);
    }
    if (!isNonEmptyBoundedString(userId)) {
        return fail('INVALID_MESSAGE', `userId 必须是非空字符串(≤${MAX_ID_LENGTH})`);
    }
    if (typeof type !== 'string' || !INBOUND_TYPES.includes(type)) {
        return fail('UNSUPPORTED_TYPE', `type 必须是 ${INBOUND_TYPES.join(' / ')}`);
    }
    const inboundType = type;
    if (inboundType === 'toggle_walker_ai' && typeof content !== 'boolean') {
        return fail('INVALID_MESSAGE', 'toggle_walker_ai 的 content 必须是布尔值');
    }
    if (inboundType === 'chat' && typeof content !== 'string') {
        return fail('INVALID_MESSAGE', 'chat 的 content 必须是字符串');
    }
    if (inboundType === 'game_tick' && !(typeof content === 'string' || isStructuredContent(content))) {
        return fail('INVALID_MESSAGE', 'game_tick 的 content 必须是字符串或结构化对象');
    }
    return {
        ok: true,
        message: {
            sessionId,
            userId,
            type: inboundType,
            content,
            timestamp: normalizeTimestamp(record.timestamp, Math.floor(now / 1000)),
        },
    };
}
function sanitizeEmotion(value) {
    return typeof value === 'string' && EMOTIONS.includes(value)
        ? value
        : 'normal';
}
function sanitizeText(value) {
    if (typeof value !== 'string')
        return '';
    return value.length > MAX_TEXT_LENGTH ? value.slice(0, MAX_TEXT_LENGTH) : value;
}
function sanitizeActions(value) {
    if (!Array.isArray(value))
        return [];
    const actions = [];
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const action = item.length > MAX_ACTION_LENGTH ? item.slice(0, MAX_ACTION_LENGTH) : item;
        if (action.length > 0)
            actions.push(action);
        if (actions.length >= MAX_ACTIONS)
            break;
    }
    return actions;
}
/** 强校验 AI 引擎输出：非法结构一律兜底为 normal/空数组/false，绝不抛错。 */
export function sanitizeEngineResult(value) {
    const record = value !== null && typeof value === 'object' ? value : {};
    const success = record.success === true;
    return {
        text: sanitizeText(record.text),
        emotion: sanitizeEmotion(record.emotion),
        action: sanitizeActions(record.action),
        success,
        errorCode: typeof record.errorCode === 'string' ? record.errorCode : success ? '' : 'ENGINE_ERROR',
        errorMsg: sanitizeText(record.errorMsg),
    };
}
/** 构造成功/任意出站报文。 */
export function makeOutbound(input) {
    const success = input.success;
    return {
        sessionId: typeof input.sessionId === 'string' ? input.sessionId : '',
        userId: typeof input.userId === 'string' ? input.userId : '',
        text: sanitizeText(input.text),
        emotion: sanitizeEmotion(input.emotion),
        action: sanitizeActions(input.action),
        success,
        errorCode: typeof input.errorCode === 'string' ? input.errorCode : '',
        errorMsg: sanitizeText(input.errorMsg),
    };
}
/** 构造失败出站报文（规格 4.2 错误样例）。 */
export function errorOutbound(sessionId, userId, errorCode, errorMsg) {
    return makeOutbound({ sessionId, userId, success: false, errorCode, errorMsg });
}
/** 序列化出站报文。 */
export function serializeOutbound(message) {
    return JSON.stringify(message);
}
//# sourceMappingURL=protocol.js.map