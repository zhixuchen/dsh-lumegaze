#!/usr/bin/env node
/**
 * S3 Agent 推理引擎验证脚本（不依赖真实 DSH 运行时 / 网络）。
 *
 * 覆盖完成定义 1-6：
 *  1. chat 返回符合规格第四章结构，text 来自 durable assistant/message 事件
 *  2. provider/model 跟随 agentDefaultModel.currentSelection()；缺失降级不崩溃
 *  3. 非法 JSON 走兜底不崩溃、回 INVALID_LLM_OUTPUT
 *  4. billion-context 已装跳过 installBundle；未装按 applied/restart-required/failed 分类
 *  5. serverUrl 空零 HTTP；非空 500/超时仅记日志且 AI 正常返回
 *  6. apply() 同步体不 await installBundle（源码静态证据）
 *  T11 回炉：
 *  7. M2 超大 JSON 动作对象不被截断成坏 JSON（2048 边界 / 4361 丢弃 / 畸形 { 丢弃）
 *  8. M4 同 sessionId 并发推理串行化，两轮回包不串话
 *  T12 回炉：
 *  9. S-M2-1 全部动作被丢弃 → success=false + ACTION_TOO_LARGE（引擎层 + 协议层）
 * 10. S-M4-1 dispose 清空 sessionGates（后续 chat 不被已释放队列阻塞）
 */

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createAgentEngine } from '../lib/agent-engine.js'
import { parseDecision, deriveEmotion, ACTION_TYPES } from '../lib/decision.js'
import { createServerClient } from '../lib/server-client.js'
import { LumegazeLogger } from '../lib/logger.js'
import { makeOutbound, sanitizeEngineResult } from '../lib/protocol.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

let passed = 0
let failed = 0
const failures = []

/** 安全 JSON.parse（用于断言出站 action[0] 反序列化后的字段）。 */
function safeParse(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failed += 1
    failures.push(name)
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n== ${title} ==`)
}

/* ------------------------------------------------------------------ */
/* 录制日志                                                            */
/* ------------------------------------------------------------------ */
function makeBaseLogger() {
  const calls = []
  const rec = (level) => (...args) => {
    calls.push({ level, args: args.map((a) => (typeof a === 'string' ? a : String(a))) })
  }
  return {
    calls,
    info: rec('info'),
    warn: rec('warn'),
    error: rec('error'),
    debug: rec('debug'),
    text: () => calls.map((c) => c.args.join(' ')).join('\n'),
  }
}

function makeLogger(base) {
  return new LumegazeLogger({ base, isDetailed: () => true, secrets: () => [] })
}

/* ------------------------------------------------------------------ */
/* 假 DSH Agent / session（durable 事件）                               */
/* ------------------------------------------------------------------ */
function makeFakeAgent(decisionText, sink) {
  const events = []
  let seq = 0
  const session = {
    get seq() {
      return seq
    },
    eventAt(index) {
      return events[index]
    },
  }
  const agent = {
    session,
    followup(message) {
      sink?.onFollowup?.(message)
      events.push({ seq: seq++, type: 'turn/start', data: {} })
      events.push({
        seq: seq++,
        type: 'assistant/message',
        data: { message: { content: [{ type: 'text', text: decisionText }] } },
      })
      events.push({ seq: seq++, type: 'turn/end', data: { reason: { kind: 'completed' } } })
    },
    whenIdle: async () => {},
    status: 'idle',
  }
  return {
    agent,
    handle: {
      agent,
      dispose: async () => {
        sink?.onDispose?.()
      },
    },
  }
}

function makeAgentsService(decisionFor, sink) {
  const created = []
  return {
    created,
    create: async (options) => {
      created.push(options)
      const decisionText = decisionFor ? decisionFor(options) : '{"thought":"t","action":{"type":"wait"},"reply_owner":"ok"}'
      return makeFakeAgent(decisionText, sink).handle
    },
  }
}

function makePluginManager({ bundles, install }) {
  const installCalls = []
  return {
    installCalls,
    listBundles: async () => bundles,
    installBundle: async (spec, options) => {
      installCalls.push({ spec, options })
      return install ? install(spec, options) : { application: 'applied' }
    },
  }
}

function makeCtx(services, base) {
  const effects = []
  return {
    services,
    effects,
    base,
    logger: () => base,
    reflect: { get: (name) => services[name] },
    effect: (fn, name) => {
      const disposer = fn()
      effects.push({ name, disposer })
      return disposer
    },
  }
}

function makeConfig(overrides = {}) {
  return {
    wsPort: 8790,
    serverUrl: '',
    personaPrompt: '你是观灵域行者，请谨慎决策。',
    authSecret: '',
    logEnabled: true,
    walkerAiSwitches: {},
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* 1. 决策 JSON 强校验 / 兜底修复                                       */
/* ------------------------------------------------------------------ */
section('决策 JSON 强校验 + 兜底修复')
{
  const valid = '{"thought":"思考","action":{"type":"collect","target":"tree","give":[],"want":[],"extra":{"goal":"x"}},"reply_owner":"主人你好","reply_other":"各位好"}'
  const fenced = '```json\n' + valid + '\n```'
  const embedded = `前缀说明\n${valid}\n后缀`
  const broken = '{"thought":"x","action":{"type":"wait","reply_owner":"ok"'
  const bad = '这不是 JSON'

  const r1 = parseDecision(valid)
  check('合法 JSON 解析通过', r1.ok === true && r1.decision.action.type === 'collect', JSON.stringify(r1))
  const r2 = parseDecision(fenced)
  check('剥 Markdown 围栏后通过', r2.ok === true, JSON.stringify(r2))
  const r3 = parseDecision(embedded)
  check('提取首个 {...} 后通过', r3.ok === true, JSON.stringify(r3))
  const r4 = parseDecision(broken)
  check('补全括号后通过', r4.ok === true, JSON.stringify(r4))
  const r5 = parseDecision(bad)
  check('非法 JSON 返回 ok:false', r5.ok === false && r5.code === 'invalid_json', JSON.stringify(r5))
  const r6 = parseDecision('{"thought":"x","action":{"type":"not_a_real_action"}}')
  check('非法 action.type 被拒', r6.ok === false && r6.code === 'invalid_action_type', JSON.stringify(r6))
  const r7 = parseDecision('{"thought":"x"}')
  check('缺少 action 被拒', r7.ok === false && r7.code === 'missing_action', JSON.stringify(r7))
  check('emotion 关键词推断', deriveEmotion('我今天特别高兴') === 'happy' && deriveEmotion('一切正常') === 'normal')
}

/* ------------------------------------------------------------------ */
/* 2. 引擎：provider/model、durable text、非法 JSON、并发隔离          */
/* ------------------------------------------------------------------ */
section('引擎 chat：provider/model + durable 文本 + 非法输出 + 并发隔离')
{
  const base = makeBaseLogger()
  const logger = makeLogger(base)
  const decisionA = '{"thought":"平静观察","action":{"type":"wait"},"reply_owner":"主人我在等待","reply_other":""}'
  const decisionB = '{"thought":"有点生气","action":{"type":"attack","target":"monster"},"reply_owner":"我去战斗","reply_other":""}'
  const agents = makeAgentsService((options) => (options.sessionId.endsWith('B') ? decisionB : decisionA))
  const services = {
    agents,
    agentDefaultModel: { currentSelection: () => ({ provider: 'loomy', model: 'spark-x2.6' }) },
    pluginManager: makePluginManager({ bundles: [{ name: 'billion-context', installed: true, enabled: true }], install: () => ({ application: 'applied' }) }),
  }
  const ctx = makeCtx(services, base)
  const spy = { called: 0 }
  const spyClient = { requestHealth: async () => { spy.called += 1; return { ok: true } }, dispose: () => {}, lastError: undefined }
  // 注入 spy serverClient（引擎每次 chat 会调用）
  const engine2 = createAgentEngine(ctx, makeConfig({ serverUrl: 'http://127.0.0.1:1' }), { logger, serverClient: spyClient })

  const outA = await engine2.chat({ sessionId: 'sess-A', userId: 'u1', content: '现在情况如何', type: 'chat' })
  check('chat 成功且 success=true', outA.success === true, JSON.stringify(outA))
  check('text 来自 durable assistant 事件（reply_owner）', outA.text === '主人我在等待', JSON.stringify(outA))
  check('action 数组元素为完整动作对象 JSON（wait）', Array.isArray(outA.action) && outA.action.length === 1 && safeParse(outA.action[0])?.type === 'wait', JSON.stringify(outA.action))
  check('emotion 来自文本推断（calm）', outA.emotion === 'calm', outA.emotion)
  check('引擎结果含规格第四章核心字段', ['text', 'emotion', 'action', 'success', 'errorCode', 'errorMsg'].every((k) => k in outA))
  const fullOutbound = makeOutbound({ sessionId: 'sess-A', userId: 'u1', ...outA })
  check('出站报文符合规格第四章结构', ['sessionId', 'userId', 'text', 'emotion', 'action', 'success', 'errorCode', 'errorMsg'].every((k) => k in fullOutbound), JSON.stringify(fullOutbound))

  const outB = await engine2.chat({ sessionId: 'sess-B', userId: 'u1', content: '怪物来了', type: 'game_tick' })
  check('game_tick 结构化 content 可处理', outB.success === true, JSON.stringify(outB))
  check(
    '多 session 并发隔离（action 不串话，且保留 target）',
    safeParse(outB.action[0])?.type === 'attack' && safeParse(outB.action[0])?.target === 'monster' && safeParse(outA.action[0])?.type === 'wait',
    JSON.stringify([outA.action, outB.action]),
  )
  check('agent.create 使用 agentDefaultModel.currentSelection()', agents.created.length === 2 && agents.created.every((o) => o.agentOptions.provider === 'loomy' && o.agentOptions.model === 'spark-x2.6'), JSON.stringify(agents.created))
  check('serverClient.requestHealth 被调用', spy.called === 2, `called=${spy.called}`)

  // 非法 JSON
  const badAgents = makeAgentsService(() => '完全不是 JSON')
  const badCtx = makeCtx({ ...services, agents: badAgents }, makeBaseLogger())
  const badEngine = createAgentEngine(badCtx, makeConfig(), { logger: makeLogger(makeBaseLogger()) })
  const outBad = await badEngine.chat({ sessionId: 'sess-C', userId: 'u1', content: 'hi', type: 'chat' })
  check('非法 JSON 回 success=false, INVALID_LLM_OUTPUT', outBad.success === false && outBad.errorCode === 'INVALID_LLM_OUTPUT', JSON.stringify(outBad))
  check('非法 JSON 不透传非法结构（action 空、text 空）', outBad.action.length === 0 && outBad.text === '', JSON.stringify(outBad))
  check('非法 JSON 不抛异常', true)

  // provider/model 缺失
  const noModelCtx = makeCtx({ agents }, makeBaseLogger())
  const noModelEngine = createAgentEngine(noModelCtx, makeConfig(), { logger: makeLogger(makeBaseLogger()) })
  const outNoModel = await noModelEngine.chat({ sessionId: 'sess-D', userId: 'u1', content: 'hi', type: 'chat' })
  check('agentDefaultModel 缺失回 MODEL_NOT_CONFIGURED 不崩溃', outNoModel.success === false && outNoModel.errorCode === 'MODEL_NOT_CONFIGURED', JSON.stringify(outNoModel))

  // agents 缺失
  const noAgentsCtx = makeCtx({ agentDefaultModel: services.agentDefaultModel }, makeBaseLogger())
  const noAgentsEngine = createAgentEngine(noAgentsCtx, makeConfig(), { logger: makeLogger(makeBaseLogger()) })
  const outNoAgents = await noAgentsEngine.chat({ sessionId: 'sess-E', userId: 'u1', content: 'hi', type: 'chat' })
  check('ctx.agents 缺失回 ENGINE_NOT_READY 不崩溃', outNoAgents.success === false && outNoAgents.errorCode === 'ENGINE_NOT_READY', JSON.stringify(outNoAgents))

  // dispose 释放缓存 agent
  let disposedCount = 0
  const disposeAgents = makeAgentsService(() => decisionA, { onDispose: () => { disposedCount += 1 } })
  const disposeCtx = makeCtx({ agents: disposeAgents, agentDefaultModel: services.agentDefaultModel }, makeBaseLogger())
  const disposeEngine = createAgentEngine(disposeCtx, makeConfig(), { logger: makeLogger(makeBaseLogger()) })
  await disposeEngine.chat({ sessionId: 'sess-F', userId: 'u1', content: 'hi', type: 'chat' })
  await disposeEngine.dispose()
  check('dispose 释放缓存 Agent', disposedCount === 1, `disposed=${disposedCount}`)
}

/* ------------------------------------------------------------------ */
/* 2.5 action[] 出站完整动作对象（T9 修复）                            */
/* ------------------------------------------------------------------ */
section('action[] 出站完整动作对象（T9 修复：target/give/want/extra）')
{
  function buildEngine(decisionText) {
    const agents = makeAgentsService(() => decisionText)
    const ctx = makeCtx(
      {
        agents,
        agentDefaultModel: { currentSelection: () => ({ provider: 'loomy', model: 'spark-x2.6' }) },
      },
      makeBaseLogger(),
    )
    return createAgentEngine(ctx, makeConfig(), { logger: makeLogger(makeBaseLogger()) })
  }

  const cases = [
    {
      name: 'move 带 target',
      decision: '{"thought":"向北探索","action":{"type":"move","target":"b02"},"reply_owner":"我去 b02","reply_other":""}',
      expect: (a) => a.type === 'move' && a.target === 'b02',
    },
    {
      name: 'wait 无 target',
      decision: '{"thought":"原地等待","action":{"type":"wait"},"reply_owner":"我等待","reply_other":""}',
      expect: (a) => a.type === 'wait' && a.target === undefined,
    },
    {
      name: 'trade_propose 多字段 give/want/extra',
      decision:
        '{"thought":"交易","action":{"type":"trade_propose","target":"merchant","give":["sword","shield"],"want":["potion"],"extra":{"reason":"trade"}},"reply_owner":"交易","reply_other":""}',
      expect: (a) =>
        a.type === 'trade_propose' &&
        a.target === 'merchant' &&
        JSON.stringify(a.give) === '["sword","shield"]' &&
        JSON.stringify(a.want) === '["potion"]' &&
        a.extra?.reason === 'trade',
    },
    {
      name: 'collect 带 target（端到端提交目标动作）',
      decision: '{"thought":"采集","action":{"type":"collect","target":"tree"},"reply_owner":"采集","reply_other":""}',
      expect: (a) => a.type === 'collect' && a.target === 'tree',
    },
  ]

  for (const c of cases) {
    const engine = buildEngine(c.decision)
    const out = await engine.chat({ sessionId: 'sess-act', userId: 'u1', content: 'tick', type: 'game_tick' })
    const parsed = out.action.length > 0 ? safeParse(out.action[0]) : null
    check(
      `engine action[0] 为完整动作对象 JSON：${c.name}`,
      out.success === true &&
        out.action.length === 1 &&
        typeof out.action[0] === 'string' &&
        out.action[0].startsWith('{') &&
        parsed !== null &&
        c.expect(parsed),
      JSON.stringify(out.action),
    )
    // 端到端：引擎结果 → sanitizeEngineResult → makeOutbound（WS 出站实际路径）
    const safe = sanitizeEngineResult(out)
    const outbound = makeOutbound({ sessionId: 'sess-act', userId: 'u1', ...safe })
    const e2e = outbound.action.length > 0 ? safeParse(outbound.action[0]) : null
    check(`出站报文 action[0] 字段完整：${c.name}`, e2e !== null && c.expect(e2e), JSON.stringify(outbound.action))
  }

  // 无动作 / 空动作仍为空数组
  const emptyOutbound = makeOutbound({ sessionId: 's', userId: 'u', success: false, errorCode: 'WALKER_AI_DISABLED', errorMsg: 'x' })
  check('无 action 出站仍为空数组', Array.isArray(emptyOutbound.action) && emptyOutbound.action.length === 0, JSON.stringify(emptyOutbound.action))
  const badEngine = buildEngine('这不是 JSON')
  const badOut = await badEngine.chat({ sessionId: 'sess-act-bad', userId: 'u1', content: 'x', type: 'chat' })
  check('非法输出 action 仍为空数组', badOut.action.length === 0, JSON.stringify(badOut.action))

  // 12 项白名单强校验仍生效
  const accepted = ACTION_TYPES.filter((t) => {
    const r = parseDecision(`{"thought":"x","action":{"type":"${t}"},"reply_owner":"ok"}`)
    return r.ok === true && r.decision.action.type === t
  })
  check('12 项白名单全部接受', ACTION_TYPES.length === 12 && accepted.length === 12, `accepted=${accepted.join(',')}`)
  const rejected = parseDecision('{"thought":"x","action":{"type":"fly"},"reply_owner":"ok"}')
  check('白名单外类型仍回 invalid_action_type（不透传）', rejected.ok === false && rejected.code === 'invalid_action_type', JSON.stringify(rejected))

  // 长 JSON 动作对象不被截断；裸类型仍按既有上限截断
  const longAction = JSON.stringify({
    type: 'give',
    target: 'ally',
    give: Array.from({ length: 40 }, (_, i) => `item-${i}`),
    want: [],
    extra: { note: 'shared loot' },
  })
  const longSafe = sanitizeEngineResult({ text: '', emotion: 'normal', action: [longAction], success: true, errorCode: '', errorMsg: '' })
  check(
    `长 JSON 动作对象（${longAction.length}>128）原样保留`,
    longSafe.action[0] === longAction && safeParse(longSafe.action[0])?.give?.length === 40,
    `len=${longSafe.action[0]?.length}`,
  )
  const bareOversized = 'w'.repeat(200)
  const bareSafe = sanitizeEngineResult({ text: '', emotion: 'normal', action: [bareOversized], success: true, errorCode: '', errorMsg: '' })
  check('裸类型仍按既有 128 上限截断', bareSafe.action[0].length === 128, `len=${bareSafe.action[0].length}`)
}

/* ------------------------------------------------------------------ */
/* 2.6 S-M2-1 引擎层：动作被整项丢弃 → success=false + ACTION_TOO_LARGE */
/* ------------------------------------------------------------------ */
section('S-M2-1 引擎层：超限动作整项丢弃回明确错误码')
{
  function buildHugeActionJson(length) {
    const payload = { type: 'give', target: 'ally', give: ['sword'], want: [], extra: { note: '' } }
    const base = JSON.stringify(payload).length
    const noteLen = length - base
    if (noteLen < 0) throw new Error(`target ${length} too small (base ${base})`)
    payload.extra.note = 'n'.repeat(noteLen)
    return JSON.stringify(payload)
  }
  const hugeAction = buildHugeActionJson(4361)
  const hugeDecision = `{"thought":"t","action":${hugeAction},"reply_owner":"ok","reply_other":""}`
  const hugeAgents = makeAgentsService(() => hugeDecision)
  const hugeCtx = makeCtx(
    {
      agents: hugeAgents,
      agentDefaultModel: { currentSelection: () => ({ provider: 'loomy', model: 'spark-x2.6' }) },
    },
    makeBaseLogger(),
  )
  const hugeEngine = createAgentEngine(hugeCtx, makeConfig(), { logger: makeLogger(makeBaseLogger()) })
  const hugeOut = await hugeEngine.chat({ sessionId: 'sess-huge', userId: 'u1', content: 'x', type: 'chat' })
  check('S-M2-1: chat 超限动作 → success=false', hugeOut.success === false, JSON.stringify(hugeOut))
  check('S-M2-1: chat 超限动作 → errorCode=ACTION_TOO_LARGE', hugeOut.errorCode === 'ACTION_TOO_LARGE', hugeOut.errorCode)
  check('S-M2-1: chat 超限动作 → action 为空', hugeOut.action.length === 0, JSON.stringify(hugeOut.action))

  // 端到端：引擎结果 → sanitizeEngineResult → makeOutbound 仍携带错误码
  const hugeSafe = sanitizeEngineResult(hugeOut)
  const hugeOutbound = makeOutbound({ sessionId: 'sess-huge', userId: 'u1', ...hugeSafe })
  check(
    'S-M2-1: 出站报文保留 success=false + ACTION_TOO_LARGE',
    hugeOutbound.success === false && hugeOutbound.errorCode === 'ACTION_TOO_LARGE',
    JSON.stringify(hugeOutbound),
  )
}

/* ------------------------------------------------------------------ */
/* 3. billion-context 检测 / 安装 / 降级                               */
/* ------------------------------------------------------------------ */
section('billion-context 检测 / 安装 / 降级')
{
  // 已安装且启用 -> 跳过 installBundle
  const installedMgr = makePluginManager({
    bundles: [{ name: 'billion-context', installed: true, enabled: true }],
    install: () => { throw new Error('must not be called') },
  })
  const installedCtx = makeCtx({ pluginManager: installedMgr }, makeBaseLogger())
  const installedEngine = createAgentEngine(installedCtx, makeConfig(), { logger: makeLogger(makeBaseLogger()) })
  const infoInstalled = await installedEngine.ensureBillionInstalled()
  check('已装跳过 installBundle（0 次调用）', installedMgr.installCalls.length === 0, `calls=${installedMgr.installCalls.length}`)
  check('已装且启用 -> memoryMode=long', installedEngine.getMemoryMode() === 'long', installedEngine.getMemoryMode())
  check('已装状态信息正确', infoInstalled.installed === true && infoInstalled.enabled === true)

  // 未装 + restart-required -> 短期降级
  const restartMgr = makePluginManager({ bundles: [], install: () => ({ application: 'restart-required' }) })
  const restartCtx = makeCtx({ pluginManager: restartMgr }, makeBaseLogger())
  const restartEngine = createAgentEngine(restartCtx, makeConfig(), { logger: makeLogger(makeBaseLogger()) })
  await restartEngine.ensureBillionInstalled()
  check('未装调用 installBundle 一次', restartMgr.installCalls.length === 1 && restartMgr.installCalls[0].spec === 'billion-context')
  check('restart-required -> memoryMode=short', restartEngine.getMemoryMode() === 'short', restartEngine.getMemoryMode())
  check('restart-required 状态记录', restartEngine.getDependencyStatus().status === 'restart-required')

  // 未装 + applied -> long
  const appliedMgr = makePluginManager({ bundles: [], install: () => ({ application: 'applied' }) })
  const appliedCtx = makeCtx({ pluginManager: appliedMgr }, makeBaseLogger())
  const appliedEngine = createAgentEngine(appliedCtx, makeConfig(), { logger: makeLogger(makeBaseLogger()) })
  await appliedEngine.ensureBillionInstalled()
  check('applied -> memoryMode=long', appliedEngine.getMemoryMode() === 'long', appliedEngine.getMemoryMode())

  // 未装 + failed -> short
  const failedMgr = makePluginManager({ bundles: [], install: () => ({ application: 'failed', error: { code: 'network' } }) })
  const failedCtx = makeCtx({ pluginManager: failedMgr }, makeBaseLogger())
  const failedEngine = createAgentEngine(failedCtx, makeConfig(), { logger: makeLogger(makeBaseLogger()) })
  await failedEngine.ensureBillionInstalled()
  check('failed -> memoryMode=short 且状态=failed', failedEngine.getMemoryMode() === 'short' && failedEngine.getDependencyStatus().status === 'failed')

  // 已装但未启用 -> 不修改、短期降级
  const disabledMgr = makePluginManager({
    bundles: [{ name: 'billion-context', installed: true, enabled: false }],
    install: () => { throw new Error('must not be called') },
  })
  const disabledCtx = makeCtx({ pluginManager: disabledMgr }, makeBaseLogger())
  const disabledEngine = createAgentEngine(disabledCtx, makeConfig(), { logger: makeLogger(makeBaseLogger()) })
  await disabledEngine.ensureBillionInstalled()
  check('已装未启用跳过 installBundle', disabledMgr.installCalls.length === 0)
  check('已装未启用 -> memoryMode=short', disabledEngine.getMemoryMode() === 'short')
}

/* ------------------------------------------------------------------ */
/* 4. serverClient：空 URL 零请求 / 500 / 超时                          */
/* ------------------------------------------------------------------ */
section('serverClient：空 URL 零请求 / 500 / 超时')
{
  const base = makeBaseLogger()
  const logger = makeLogger(base)

  // 空 URL 零请求
  let fetchCalls = 0
  const emptyClient = createServerClient(logger, () => '', {
    fetchImpl: async () => { fetchCalls += 1; return { ok: true, status: 200 } },
  })
  const emptyResult = await emptyClient.requestHealth()
  check('serverUrl 空 -> 零 fetch 请求', fetchCalls === 0 && emptyResult.ok === false, `fetchCalls=${fetchCalls}`)

  // 500
  const server500 = createServer((req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('boom')
  })
  await new Promise((resolve) => server500.listen(0, '127.0.0.1', resolve))
  const port500 = server500.address().port
  const base500 = makeBaseLogger()
  const client500 = createServerClient(makeLogger(base500), () => `http://127.0.0.1:${port500}`)
  const r500 = await client500.requestHealth()
  check('HTTP 500 -> ok:false, status=500', r500.ok === false && r500.status === 500, JSON.stringify(r500))
  check('HTTP 500 写 [server] 日志', base500.text().includes('[server]'), base500.text())

  // 引擎集成：500 不影响 AI 正常返回（在关闭 server500 之前）
  const decision = '{"thought":"x","action":{"type":"say"},"reply_owner":"ok","reply_other":""}'
  const agents = makeAgentsService(() => decision)
  const ctx = makeCtx(
    { agents, agentDefaultModel: { currentSelection: () => ({ provider: 'loomy', model: 'spark-x2.6' }) } },
    makeBaseLogger(),
  )
  const engine = createAgentEngine(ctx, makeConfig({ serverUrl: `http://127.0.0.1:${port500}` }), { logger: makeLogger(makeBaseLogger()) })
  const out = await engine.chat({ sessionId: 'sess-G', userId: 'u1', content: 'hi', type: 'chat' })
  check('server 500 时 AI 仍正常返回', out.success === true && out.text === 'ok', JSON.stringify(out))
  server500.close()

  // 超时
  const slowServer = createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200)
      res.end('late')
    }, 500)
  })
  await new Promise((resolve) => slowServer.listen(0, '127.0.0.1', resolve))
  const portSlow = slowServer.address().port
  const baseSlow = makeBaseLogger()
  const clientSlow = createServerClient(makeLogger(baseSlow), () => `http://127.0.0.1:${portSlow}`, { timeoutMs: 100 })
  const rSlow = await clientSlow.requestHealth()
  check('超时 -> ok:false 且有错误信息', rSlow.ok === false && typeof rSlow.error === 'string' && rSlow.error.length > 0, JSON.stringify(rSlow))
  check('超时写 [server] 日志', baseSlow.text().includes('[server]'), baseSlow.text())
  slowServer.close()
}

/* ------------------------------------------------------------------ */
/* 5. 静态代码证据：apply() 不 await installBundle                     */
/* ------------------------------------------------------------------ */
section('静态代码证据：apply 不 await installBundle / 无 billion 卸载')
{
  const src = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
  const applyBody = src.slice(src.indexOf('export function apply'), src.indexOf('export function apply') + 4000)
  check('apply 内以 void 触发 ensureBillionInstalled', /void\s+engine\s*\.\s*ensureBillionInstalled\(\)/.test(applyBody))
  check('apply 内不 await ensureBillionInstalled', !/await\s+engine\.ensureBillionInstalled\(\)/.test(applyBody))
  check('apply 内不 await installBundle', !/await\s+\w+\.installBundle\(/.test(applyBody))

  const allSrc = ['index.ts', 'agent-engine.ts', 'billion-context.ts', 'server-client.ts', 'decision.ts']
    .map((f) => readFileSync(join(ROOT, 'src', f), 'utf8'))
    .join('\n')
  check('无卸载/修改 billion-context 调用', !/setBundleEnabled|setPluginEnabled|uninstallBundle|removeBundle/.test(allSrc))
  check('无自建向量库 / 记忆落盘', !/sqlite|vector|embedding|writeFile.*memory|localStorage/i.test(allSrc))
  check('无 Ollama / 第三方大模型直连', !/11434|ollama\.com|openai\.com|api\.deepseek\.com/i.test(allSrc))
}

/* ------------------------------------------------------------------ */
/* 6. apply() 端到端：引擎注入 + 同步返回 + 分离式 billion 安装        */
/* ------------------------------------------------------------------ */
section('apply() 端到端：引擎注入 + 分离式 billion 安装')
{
  const { apply, getEngine } = await import('../lib/index.js')

  let installResolved = false
  let installStarted = false
  const installPromise = new Promise((resolve) => {
    setTimeout(() => {
      installResolved = true
      resolve({ application: 'applied' })
    }, 80)
  })
  const pluginManager = {
    listBundles: async () => [],
    installBundle: async () => {
      installStarted = true
      return installPromise
    },
  }
  const base = makeBaseLogger()
  const ctx = makeCtx({ pluginManager }, base)
  const config = makeConfig({ wsPort: 18790, serverUrl: '', logEnabled: true })

  const t0 = Date.now()
  apply(ctx, config)
  const applyReturnedAt = Date.now() - t0
  check('apply() 同步返回（不 await installBundle）', applyReturnedAt < 60, `returnedAt=${applyReturnedAt}ms`)
  check('apply 后引擎已注入（AgentEngineHandle 而非占位）', typeof getEngine().getDependencyStatus === 'function' && typeof getEngine().ensureBillionInstalled === 'function')

  await new Promise((resolve) => setTimeout(resolve, 150))
  check('installBundle 在 apply 返回后异步触发并结算（分离式）', installStarted === true && installResolved === true && applyReturnedAt < 80)

  // 逆序执行 disposer，清理 WS 服务与 agent
  for (const effect of [...ctx.effects].reverse()) {
    if (typeof effect?.disposer === 'function') {
      await effect.disposer()
    }
  }
  check('apply disposer 可逆序清理', true)
}

/* ------------------------------------------------------------------ */
/* 7. M2 超大 JSON 动作对象不被截断成坏 JSON                           */
/* ------------------------------------------------------------------ */
section('M2 超大 JSON 动作对象不被截断成坏 JSON')
{
  /** 构造恰好 `length` 字符的合法 give 动作对象 JSON。 */
  function buildExactLengthAction(length) {
    const payload = { type: 'give', target: 'ally', give: ['sword'], want: [], extra: { note: '' } }
    const base = JSON.stringify(payload).length
    const noteLen = length - base
    if (noteLen < 0) throw new Error(`target ${length} too small (base ${base})`)
    payload.extra.note = 'n'.repeat(noteLen)
    return JSON.stringify(payload)
  }

  const atLimit = buildExactLengthAction(2048)
  const overLimit = buildExactLengthAction(4361)
  check('构造恰好 2048 字符合法 JSON 动作', atLimit.length === 2048)
  check('构造 4361 字符合法 JSON 动作', overLimit.length === 4361)

  const drops = []
  const atSafe = sanitizeEngineResult(
    { text: '', emotion: 'normal', action: [atLimit], success: true, errorCode: '', errorMsg: '' },
    { onDrop: (reason, item) => drops.push({ reason, len: item.length }) },
  )
  check(
    '2048 字符（≤上限）完整保留',
    atSafe.action[0] === atLimit && safeParse(atSafe.action[0])?.type === 'give',
    `len=${atSafe.action[0]?.length}`,
  )

  const overSafe = sanitizeEngineResult(
    { text: '', emotion: 'normal', action: [overLimit], success: true, errorCode: '', errorMsg: '' },
    { onDrop: (reason, item) => drops.push({ reason, len: item.length }) },
  )
  const overOut = overSafe.action[0]
  const overParsed = overOut === undefined ? null : safeParse(overOut)
  check(
    '4361 字符超限动作不产出坏 JSON（完整保留或整项丢弃）',
    (overOut === undefined && overSafe.action.length === 0) ||
      (overOut !== undefined && overParsed !== null && overOut === overLimit),
    `outLen=${overOut === undefined ? 'none' : overOut.length}`,
  )
  check(
    '超限动作触发丢弃日志（json_action_too_large）',
    drops.some((d) => d.reason === 'json_action_too_large' && d.len === 4361),
    JSON.stringify(drops),
  )
  check('超限动作不再「success:true + 坏 JSON」静默通过', !(overOut !== undefined && overParsed === null))

  // 以 `{` 开头但非合法 JSON：必须整项丢弃，绝不落入裸类型 128 截断。
  const malformed = '{' + 'a'.repeat(300)
  const malSafe = sanitizeEngineResult(
    { text: '', emotion: 'normal', action: [malformed], success: true, errorCode: '', errorMsg: '' },
    { onDrop: (reason) => drops.push({ reason }) },
  )
  check(
    '畸形 { 动作整项丢弃，不截断成坏 JSON',
    malSafe.action.length === 0 && drops.some((d) => d.reason === 'malformed_json_action'),
    JSON.stringify(malSafe.action),
  )

  // 客户端解析视角：要么完整，要么明确无候选，绝不半截坏 JSON。
  const clientParse = (raw) => {
    try {
      return { ok: true, value: JSON.parse(raw) }
    } catch {
      return { ok: false }
    }
  }
  for (const raw of [atLimit, overLimit]) {
    const safe = sanitizeEngineResult({ text: '', emotion: 'normal', action: [raw], success: true, errorCode: '', errorMsg: '' })
    const candidate = safe.action[0]
    if (candidate !== undefined) {
      const parsed = clientParse(candidate)
      check(`客户端解析候选（${raw.length} 字符）不产生坏 JSON`, parsed.ok === true && parsed.value.type === 'give')
    } else {
      check(`客户端解析候选（${raw.length} 字符）明确无候选`, safe.action.length === 0)
    }
  }

  // 裸类型 128 截断的既有行为不变。
  const bare = 'w'.repeat(200)
  const bareSafe = sanitizeEngineResult({ text: '', emotion: 'normal', action: [bare], success: true, errorCode: '', errorMsg: '' })
  check('裸类型仍按既有 128 上限截断', bareSafe.action[0].length === 128, `len=${bareSafe.action[0].length}`)

  // S-M2-1：全部动作被丢弃 → success:false + ACTION_TOO_LARGE
  const overAll = sanitizeEngineResult(
    { text: 'ok', emotion: 'normal', action: [overLimit], success: true, errorCode: '', errorMsg: '' },
    { onDrop: (reason, item) => drops.push({ reason, len: item.length }) },
  )
  check('S-M2-1: 全部动作被丢弃 → success=false', overAll.success === false, JSON.stringify(overAll))
  check('S-M2-1: 全部动作被丢弃 → errorCode=ACTION_TOO_LARGE', overAll.errorCode === 'ACTION_TOO_LARGE', overAll.errorCode)
  check('S-M2-1: 全部动作被丢弃 → errorMsg 明确', overAll.errorMsg.includes('上限'), overAll.errorMsg)
  check('S-M2-1: 全部动作被丢弃 → action 为空', overAll.action.length === 0, JSON.stringify(overAll.action))

  // 部分丢弃：保留成功，仅记录丢弃项
  const partialOversized = buildExactLengthAction(4361)
  const partial = sanitizeEngineResult(
    { text: 'ok', emotion: 'normal', action: ['wave', partialOversized], success: true, errorCode: '', errorMsg: '' },
    { onDrop: () => {} },
  )
  check(
    'S-M2-1: 部分丢弃仍保留 success=true',
    partial.success === true && partial.action.length === 1 && partial.action[0] === 'wave',
    JSON.stringify(partial),
  )

  // 空动作（无丢弃）不触发失败
  const noAction = sanitizeEngineResult({ text: 'ok', emotion: 'normal', action: [], success: true, errorCode: '', errorMsg: '' })
  check('S-M2-1: 空动作（无丢弃）仍 success=true', noAction.success === true && noAction.errorCode === '', JSON.stringify(noAction))

  // 畸形 { 整项丢弃 → 明确错误码
  const malAll = sanitizeEngineResult({ text: 'ok', emotion: 'normal', action: [malformed], success: true, errorCode: '', errorMsg: '' })
  check(
    'S-M2-1: 畸形动作整项丢弃 → success=false, errorCode=ACTION_TOO_LARGE',
    malAll.success === false && malAll.errorCode === 'ACTION_TOO_LARGE',
    JSON.stringify(malAll),
  )
}

/* ------------------------------------------------------------------ */
/* 8. M4 同 sessionId 并发推理串行化（不串话）                          */
/* ------------------------------------------------------------------ */
section('M4 同 sessionId 并发推理串行化（不串话）')
{
  const DECISION_A = '{"thought":"A","action":{"type":"wait"},"reply_owner":"回A","reply_other":""}'
  const DECISION_B = '{"thought":"B","action":{"type":"attack","target":"monster"},"reply_owner":"回B","reply_other":""}'

  /**
   * 竞态假 Agent：`followup` 把本轮 assistant/message 延迟到下一个 macrotask
   * 才落盘（模拟真实 DSH Agent 的异步 turn），并记录每次 followup 时的 session.seq。
   * 未串行化时两个 chat 都在 seq=0 处 followup，两轮事件交错后 summarize 都读到
   * 最后一条 assistant/message → 串话。
   */
  function makeRacyAgentsService() {
    const events = []
    let seq = 0
    let pending = 0
    const waiters = []
    const followupCalls = []
    const session = {
      get seq() {
        return seq
      },
      eventAt(index) {
        return events[index]
      },
    }
    const agent = {
      session,
      status: 'idle',
      followup(message) {
        followupCalls.push({ atSeq: session.seq })
        const text = /AAAA/.test(JSON.stringify(message)) ? DECISION_A : DECISION_B
        pending += 1
        setTimeout(() => {
          events.push({ seq: seq++, type: 'turn/start', data: {} })
          events.push({ seq: seq++, type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } })
          events.push({ seq: seq++, type: 'turn/end', data: { reason: { kind: 'completed' } } })
          pending -= 1
          if (pending === 0) {
            while (waiters.length) waiters.shift()()
          }
        }, 5)
      },
      whenIdle: () =>
        new Promise((resolve) => {
          if (pending === 0) resolve()
          else waiters.push(resolve)
        }),
    }
    return {
      followupCalls,
      create: async () => ({ agent, dispose: async () => {} }),
    }
  }

  const agents = makeRacyAgentsService()
  const ctx = makeCtx(
    { agents, agentDefaultModel: { currentSelection: () => ({ provider: 'loomy', model: 'spark-x2.6' }) } },
    makeBaseLogger(),
  )
  const engine = createAgentEngine(ctx, makeConfig(), { logger: makeLogger(makeBaseLogger()) })

  const [outA, outB] = await Promise.all([
    engine.chat({ sessionId: 'sess-conc', userId: 'u1', content: 'AAAA', type: 'chat' }),
    engine.chat({ sessionId: 'sess-conc', userId: 'u1', content: 'BBBB', type: 'chat' }),
  ])

  check('并发回包 A 文本对应 A 输入', outA.success === true && outA.text === '回A', JSON.stringify(outA))
  check('并发回包 B 文本对应 B 输入', outB.success === true && outB.text === '回B', JSON.stringify(outB))
  check(
    '同 sessionId 推理串行化（第二次 followup 时首轮事件已落盘）',
    agents.followupCalls.length === 2 && agents.followupCalls[1].atSeq >= 3,
    JSON.stringify(agents.followupCalls),
  )
}

/* ------------------------------------------------------------------ */
/* 8.1 S-M4-1 dispose 清空 sessionGates                               */
/* ------------------------------------------------------------------ */
section('S-M4-1 dispose 清空 sessionGates')
{
  const DECISION = '{"thought":"A","action":{"type":"wait"},"reply_owner":"回A","reply_other":""}'

  /** 可控 Agent：gated=true 时 whenIdle 返回可控闸门，模拟推理未结束。 */
  function makeGatedAgent(decisionText, gated) {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const events = []
    let seq = 0
    const session = {
      get seq() {
        return seq
      },
      eventAt(index) {
        return events[index]
      },
    }
    const agent = {
      session,
      status: 'idle',
      followup() {
        events.push({ seq: seq++, type: 'turn/start', data: {} })
        events.push({ seq: seq++, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: decisionText }] } } })
        events.push({ seq: seq++, type: 'turn/end', data: {} })
      },
      whenIdle: () => (gated ? gate : Promise.resolve()),
    }
    return { agent, release }
  }

  let nextGated = true
  const created = []
  const madeList = []
  const agents = {
    created,
    create: async (options) => {
      created.push(options)
      const made = makeGatedAgent(DECISION, nextGated)
      nextGated = false
      madeList.push(made)
      return {
        agent: made.agent,
        dispose: async () => {
          made.disposed = true
        },
      }
    },
  }
  const ctx = makeCtx(
    { agents, agentDefaultModel: { currentSelection: () => ({ provider: 'loomy', model: 'spark-x2.6' }) } },
    makeBaseLogger(),
  )
  const engine = createAgentEngine(ctx, makeConfig(), { logger: makeLogger(makeBaseLogger()) })

  const pA = engine.chat({ sessionId: 'sess-gate', userId: 'u1', content: 'x', type: 'chat' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  check('S-M4-1: 首轮 chat 进入阻塞态（whenIdle 未释放）', madeList.length === 1 && madeList[0].disposed !== true)
  await engine.dispose()
  check('S-M4-1: dispose 释放首轮 Agent', madeList[0].disposed === true)

  // 若 sessionGates 未清空，本次 chat 会挂在首轮未结算的 settled 链上；
  // 清空后应立即在新建 Agent 上执行并返回。
  const bTimeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('后续 chat 被已释放队列阻塞')), 2000),
  )
  const outB = await Promise.race([
    engine.chat({ sessionId: 'sess-gate', userId: 'u1', content: 'y', type: 'chat' }),
    bTimeout,
  ])
  check('S-M4-1: dispose 后新 chat 立即执行（不被已释放队列阻塞）', outB.success === true, JSON.stringify(outB))
  check('S-M4-1: 新 chat 创建新 Agent（未复用已释放 Agent）', created.length === 2, `created=${created.length}`)

  madeList[0].release()
  await pA
}

/* ------------------------------------------------------------------ */
console.log(`\n合计: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('失败项: ' + failures.join(', '))
  process.exit(1)
}
console.log('S3 agent-engine check: ALL PASS')
