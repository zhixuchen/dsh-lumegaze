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
export const EMOTIONS = ['normal', 'happy', 'sad', 'shy', 'angry', 'calm'] as const
export type Emotion = (typeof EMOTIONS)[number]

/** 入站 type 枚举（规格第四章）。 */
export const INBOUND_TYPES = ['chat', 'game_tick', 'toggle_walker_ai'] as const
export type InboundType = (typeof INBOUND_TYPES)[number]

/** 规格错误码 + 协议层错误码。 */
export type ErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_MESSAGE'
  | 'UNSUPPORTED_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'WALKER_AI_DISABLED'
  | 'ENGINE_NOT_READY'
  | 'ENGINE_ERROR'
  | 'INTERNAL_ERROR'

/** 入站报文（规格第四章 4.1）。 */
export interface InboundMessage {
  sessionId: string
  userId: string
  type: InboundType
  content: unknown
  timestamp: number
}

/** 出站报文（规格第四章 4.2）。 */
export interface OutboundMessage {
  sessionId: string
  userId: string
  text: string
  emotion: Emotion
  action: string[]
  success: boolean
  errorCode: string
  errorMsg: string
}

/** AI 引擎返回结果经过强校验后的形状。 */
export interface EngineResult {
  text: string
  emotion: Emotion
  action: string[]
  success: boolean
  errorCode: string
  errorMsg: string
}

export interface InboundParseSuccess {
  ok: true
  message: InboundMessage
}
export interface InboundParseFailure {
  ok: false
  errorCode: ErrorCode
  errorMsg: string
}
export type InboundParseResult = InboundParseSuccess | InboundParseFailure

const MAX_ID_LENGTH = 128
const MAX_TEXT_LENGTH = 64 * 1024
const MAX_ACTIONS = 16
const MAX_ACTION_LENGTH = 128

function fail(errorCode: ErrorCode, errorMsg: string): InboundParseFailure {
  return { ok: false, errorCode, errorMsg }
}

function isNonEmptyBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
}

function isStructuredContent(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

function normalizeTimestamp(value: unknown, nowSeconds: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : nowSeconds
}

/** 从文本帧解析入站报文；非法 JSON 返回 INVALID_JSON。 */
export function parseInboundText(raw: string, now = Date.now()): InboundParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail('INVALID_JSON', '非法 JSON 帧')
  }
  return parseInbound(parsed, now)
}

/** 校验并归一化一个已解析的入站对象。 */
export function parseInbound(value: unknown, now = Date.now()): InboundParseResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('INVALID_MESSAGE', '报文必须是 JSON 对象')
  }
  const record = value as Record<string, unknown>
  const { sessionId, userId, type, content } = record

  if (!isNonEmptyBoundedString(sessionId)) {
    return fail('INVALID_MESSAGE', `sessionId 必须是非空字符串(≤${MAX_ID_LENGTH})`)
  }
  if (!isNonEmptyBoundedString(userId)) {
    return fail('INVALID_MESSAGE', `userId 必须是非空字符串(≤${MAX_ID_LENGTH})`)
  }
  if (typeof type !== 'string' || !(INBOUND_TYPES as readonly string[]).includes(type)) {
    return fail('UNSUPPORTED_TYPE', `type 必须是 ${INBOUND_TYPES.join(' / ')}`)
  }
  const inboundType = type as InboundType

  if (inboundType === 'toggle_walker_ai' && typeof content !== 'boolean') {
    return fail('INVALID_MESSAGE', 'toggle_walker_ai 的 content 必须是布尔值')
  }
  if (inboundType === 'chat' && typeof content !== 'string') {
    return fail('INVALID_MESSAGE', 'chat 的 content 必须是字符串')
  }
  if (inboundType === 'game_tick' && !(typeof content === 'string' || isStructuredContent(content))) {
    return fail('INVALID_MESSAGE', 'game_tick 的 content 必须是字符串或结构化对象')
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
  }
}

function sanitizeEmotion(value: unknown): Emotion {
  return typeof value === 'string' && (EMOTIONS as readonly string[]).includes(value)
    ? (value as Emotion)
    : 'normal'
}

function sanitizeText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.length > MAX_TEXT_LENGTH ? value.slice(0, MAX_TEXT_LENGTH) : value
}

function sanitizeActions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const actions: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const action = item.length > MAX_ACTION_LENGTH ? item.slice(0, MAX_ACTION_LENGTH) : item
    if (action.length > 0) actions.push(action)
    if (actions.length >= MAX_ACTIONS) break
  }
  return actions
}

/** 强校验 AI 引擎输出：非法结构一律兜底为 normal/空数组/false，绝不抛错。 */
export function sanitizeEngineResult(value: unknown): EngineResult {
  const record = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const success = record.success === true
  return {
    text: sanitizeText(record.text),
    emotion: sanitizeEmotion(record.emotion),
    action: sanitizeActions(record.action),
    success,
    errorCode: typeof record.errorCode === 'string' ? record.errorCode : success ? '' : 'ENGINE_ERROR',
    errorMsg: sanitizeText(record.errorMsg),
  }
}

/** 构造成功/任意出站报文。 */
export function makeOutbound(input: {
  sessionId: string
  userId: string
  text?: unknown
  emotion?: unknown
  action?: unknown
  success: boolean
  errorCode?: unknown
  errorMsg?: unknown
}): OutboundMessage {
  const success = input.success
  return {
    sessionId: typeof input.sessionId === 'string' ? input.sessionId : '',
    userId: typeof input.userId === 'string' ? input.userId : '',
    text: sanitizeText(input.text),
    emotion: sanitizeEmotion(input.emotion),
    action: sanitizeActions(input.action),
    success,
    errorCode: typeof input.errorCode === 'string' ? input.errorCode : '',
    errorMsg: sanitizeText(input.errorMsg),
  }
}

/** 构造失败出站报文（规格 4.2 错误样例）。 */
export function errorOutbound(sessionId: string, userId: string, errorCode: string, errorMsg: string): OutboundMessage {
  return makeOutbound({ sessionId, userId, success: false, errorCode, errorMsg })
}

/** 序列化出站报文。 */
export function serializeOutbound(message: OutboundMessage): string {
  return JSON.stringify(message)
}
