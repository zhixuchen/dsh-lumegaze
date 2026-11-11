#!/usr/bin/env node
/**
 * T6 端到端联调验证（S1-S5 + T7 + T9 全链路）。
 *
 * 运行：node scripts/e2e-check.mjs
 *
 * 与既有单测的区别：这里跑的是**真实 apply() + 真实 WsGateway + 真实 AgentEngine
 * + 真实 ws 客户端**，而不是把引擎替换成 spy。仅 `ctx.agents` / `agentDefaultModel` /
 * `pluginManager` 用进程内假实现（真实 DSH 运行时 / Tauri WebView 无法在本机无头跑）。
 *
 * 覆盖完成定义 5 类场景：
 *  1) 开关开 → game_tick(感知包) → 插件回包结构化 → 客户端 adaptPluginOutboundToDecision 重建 action
 *  2) 开关关 → WALKER_AI_DISABLED 拦截，引擎零调用
 *  3) 服务端 URL 配错（连接拒绝）/ 超时 → 仅 [server] 日志，不阻断 AI
 *  4) 非法 LLM 输出 → 兜底回 INVALID_LLM_OUTPUT，服务不崩溃、后续请求仍可用
 *  5) 两个 sessionId 并发隔离（回包 sessionId/userId 不串话）
 */
import { createServer } from 'node:http'
import net from 'node:net'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import { WebSocket } from 'ws'
import * as plugin from '../lib/index.js'
import { SETTINGS_NAMESPACE } from '../lib/config.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolvePath(HERE, '..')
const CLIENT_ROOT = '/Users/admin/观灵域/client'

const problems = []
let passed = 0
let failed = 0

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`PASS  ${name}`)
  } else {
    failed += 1
    problems.push(name)
    console.log(`FAIL  ${name}${detail ? `  (${detail})` : ''}`)
  }
}

function section(title) {
  console.log(`\n== ${title} ==`)
}

function safeParse(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/* ------------------------------------------------------------------ */
/* 假 DSH Agent / session（durable 事件，与 agent-engine-check 同构）    */
/* ------------------------------------------------------------------ */
function makeFakeAgent(decisionText) {
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
    followup() {
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
  return { agent, handle: { agent, dispose: async () => {} } }
}

function makeAgentsService(decisionFor) {
  const created = []
  return {
    created,
    create: async (options) => {
      created.push(options)
      return makeFakeAgent(decisionFor(options)).handle
    },
  }
}

function makePluginManager({ bundles, install } = {}) {
  const installCalls = []
  return {
    installCalls,
    listBundles: async () => bundles ?? [{ name: 'billion-context', installed: true, enabled: true }],
    installBundle: async (spec, options) => {
      installCalls.push({ spec, options })
      return install ? install(spec, options) : { application: 'applied' }
    },
  }
}

/* ------------------------------------------------------------------ */
/* WS 客户端                                                           */
/* ------------------------------------------------------------------ */
class Collector {
  constructor(ws) {
    this.queue = []
    this.waiters = []
    this.all = []
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      this.all.push(msg)
      this.queue.push(msg)
      this.flush()
    })
  }
  flush() {
    while (this.queue.length && this.waiters.length) this.waiters.shift()(this.queue.shift())
  }
  next(timeoutMs = 5000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs)
      this.waiters.push((m) => {
        clearTimeout(timer)
        resolve(m)
      })
    })
  }
}

function openClient(headers, url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers })
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error('connect timeout'))
    }, 5000)
    ws.on('open', () => {
      clearTimeout(timer)
      resolve(ws)
    })
    ws.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer)
      reject(new Error(`HTTP ${res.statusCode}`))
    })
  })
}

/* ------------------------------------------------------------------ */
/* 主流程                                                             */
/* ------------------------------------------------------------------ */
const AUTH = 'e2e-sentinel-8f7e6d5c4b3a'
const PERCEPTION = {
  tick: 1001,
  world: { x: 12, y: -3 },
  nearby: [
    { id: 'tree-1', kind: 'resource', kind_id: 'tree', hp: 10 },
    { id: 'monster-9', kind: 'npc', kind_id: 'goblin', hp: 7 },
  ],
  public_chat: ['观者：小心身后', '行者乙：我来支援'],
}

async function main() {
  const port = await freePort()
  const baseUrl = `ws://127.0.0.1:${port}`

  const messages = []
  const ctx = new Context()
  const offExporter = ctx.logger.exporter({ export: (message) => messages.push(message) })
  // cordis logger 导出的是未格式化的 [format, ...params]，这里按 args 还原判定。
  const serverFailureMessages = (fromIndex = 0) =>
    messages
      .slice(fromIndex)
      .filter(
        (m) =>
          String(m.args?.[0] ?? '').includes('server request') &&
          String(m.args?.[2] ?? '').length > 0,
      )

  // mock ctx.settings（profile patch 持久化开关）
  const persisted = { value: {} }
  ctx.provide('settings', {
    describe: () => [{ ns: SETTINGS_NAMESPACE, revision: 1 }],
    mutate: async (ns, ops) => {
      for (const op of ops) {
        if (op.op === 'set' && op.path[0] === 'walkerAiSwitches') persisted.value = { ...op.value }
      }
    },
  })

  const DECISION_TICK =
    '{"thought":"平静观察，向北移动并采集资源","action":{"type":"move","target":"b02","give":[],"want":["wood"],"extra":{"reason":"expansion"}},"reply_owner":"主人，我向 b02 移动","reply_other":"各位，我去采集"}'
  const DECISION_ATTACK =
    '{"thought":"怪物逼近，我有点生气","action":{"type":"attack","target":"monster-9"},"reply_owner":"主人，我去战斗","reply_other":""}'

  const agents = makeAgentsService((options) => {
    const sid = String(options.sessionId)
    if (sid === 'sess-bad') return '完全不是 JSON 的模型输出'
    if (sid === 'sess-B') return DECISION_ATTACK
    return DECISION_TICK
  })
  const pluginManager = makePluginManager()
  ctx.provide('agents', agents)
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'loomy', model: 'spark-x2.6' }) })
  ctx.provide('pluginManager', pluginManager)

  async function boot(overrides = {}) {
    const fiber = await ctx.plugin(plugin, {
      wsPort: port,
      logEnabled: true,
      authSecret: AUTH,
      walkerAiSwitches: {},
      personaPrompt: '你是观灵域行者，谨慎决策。',
      ...overrides,
    })
    const ws = await openClient({ 'x-lumegaze-auth': AUTH }, baseUrl)
    return { fiber, ws, collector: new Collector(ws) }
  }

  /* ---------- 场景 1：开关开 → game_tick → 结构化回包 ---------- */
  section('场景 1：开关开 → game_tick(感知包) → 结构化回包')
  let conn = await boot()
  try {
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-A',
        userId: 'u1',
        type: 'toggle_walker_ai',
        content: true,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    const toggle = await conn.collector.next()
    check('toggle on 返回 success=true', toggle.success === true, JSON.stringify(toggle))

    const createdBefore = agents.created.length
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-A',
        userId: 'u1',
        type: 'game_tick',
        content: PERCEPTION,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    const reply = await conn.collector.next()
    check('game_tick 回包 success=true', reply.success === true, JSON.stringify(reply))
    check(
      '回包符合规格第四章结构（8 字段）',
      ['sessionId', 'userId', 'text', 'emotion', 'action', 'success', 'errorCode', 'errorMsg'].every((k) => k in reply),
      JSON.stringify(Object.keys(reply)),
    )
    check('回包 sessionId/userId 回填正确', reply.sessionId === 'sess-A' && reply.userId === 'u1', JSON.stringify(reply))
    check('text 来自 durable assistant 事件', reply.text === '主人，我向 b02 移动', reply.text)
    check('emotion 由文本推断为 calm', reply.emotion === 'calm', reply.emotion)
    const actionObj = safeParse(reply.action[0])
    check(
      'action[0] 为完整动作对象 JSON（type/target/give/want/extra）',
      actionObj !== null && actionObj.type === 'move' && actionObj.target === 'b02' &&
        Array.isArray(actionObj.give) && Array.isArray(actionObj.want) && actionObj.extra?.reason === 'expansion',
      JSON.stringify(reply.action),
    )
    check('感知包触发真实 Agent create 一次', agents.created.length === createdBefore + 1)

    // 客户端侧：adaptPluginOutboundToDecision 重建 WalkerAction
    const bridge = await loadClientBridge()
    if (bridge) {
      const adapted = bridge.adaptPluginOutboundToDecision(reply)
      check(
        '客户端 adaptPluginOutboundToDecision 接受插件回包',
        adapted.ok === true,
        adapted.ok ? '' : JSON.stringify(adapted),
      )
      check(
        '客户端重建动作保留 target/give/want/extra',
        adapted.ok === true &&
          adapted.decision.action.type === 'move' &&
          adapted.decision.action.target === 'b02' &&
          JSON.stringify(adapted.decision.action.give) === '[]' &&
          JSON.stringify(adapted.decision.action.want) === '["wood"]' &&
          adapted.decision.action.extra?.reason === 'expansion',
        adapted.ok ? JSON.stringify(adapted.decision.action) : '',
      )
      check('客户端 emotion 透传', adapted.ok === true && adapted.emotion === reply.emotion)
    } else {
      check('客户端 adaptPluginOutboundToDecision（真实 client 模块）', false, '客户端模块不可加载，未验证')
    }

    /* ---------- 场景 2：开关关 → WALKER_AI_DISABLED 拦截 ---------- */
    section('场景 2：开关关 → WALKER_AI_DISABLED 拦截')
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-off',
        userId: 'u2',
        type: 'toggle_walker_ai',
        content: false,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    await conn.collector.next()
    const callsBeforeOff = agents.created.length
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-off',
        userId: 'u2',
        type: 'chat',
        content: '关掉开关后还在吗',
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    const offReply = await conn.collector.next()
    check('关闭开关回 success=false', offReply.success === false, JSON.stringify(offReply))
    check('关闭开关 errorCode=WALKER_AI_DISABLED', offReply.errorCode === 'WALKER_AI_DISABLED', offReply.errorCode)
    check(
      '关闭开关 errorMsg 符合规格',
      offReply.errorMsg === '行者AI能力未开启，请先打开开关',
      offReply.errorMsg,
    )
    check('关闭开关不调用 Agent（引擎零调用）', agents.created.length === callsBeforeOff, `${callsBeforeOff}->${agents.created.length}`)

    /* ---------- 场景 4：非法 LLM 输出兜底不崩溃 ---------- */
    section('场景 4：非法 LLM 输出 → 兜底不崩溃')
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-bad',
        userId: 'u1',
        type: 'toggle_walker_ai',
        content: true,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    await conn.collector.next()
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-bad',
        userId: 'u1',
        type: 'chat',
        content: '给我一个坏输出',
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    const badReply = await conn.collector.next()
    check('非法 LLM 输出回 success=false', badReply.success === false, JSON.stringify(badReply))
    check('非法 LLM 输出 errorCode=INVALID_LLM_OUTPUT', badReply.errorCode === 'INVALID_LLM_OUTPUT', badReply.errorCode)
    check('非法 LLM 输出不透传非法结构（action 空）', Array.isArray(badReply.action) && badReply.action.length === 0, JSON.stringify(badReply.action))

    // 服务仍存活：再发一次合法请求
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-A',
        userId: 'u1',
        type: 'chat',
        content: '坏输出之后还能用吗',
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    const afterBad = await conn.collector.next()
    check('非法输出后服务仍存活、后续请求成功', afterBad.success === true, JSON.stringify(afterBad))

    /* ---------- 场景 5：两个 sessionId 并发隔离 ---------- */
    section('场景 5：两个 sessionId 并发隔离')
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-B',
        userId: 'u1',
        type: 'toggle_walker_ai',
        content: true,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    await conn.collector.next()
    const pA = conn.collector.next()
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-A',
        userId: 'u1',
        type: 'game_tick',
        content: PERCEPTION,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    const pB = conn.collector.next()
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-B',
        userId: 'u1',
        type: 'chat',
        content: '怪物来了',
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    const [resA, resB] = await Promise.all([pA, pB])
    check(
      '并发 session A 回包保持自身 sessionId/userId',
      resA.sessionId === 'sess-A' && resA.userId === 'u1',
      JSON.stringify(resA),
    )
    check(
      '并发 session B 回包保持自身 sessionId/userId',
      resB.sessionId === 'sess-B' && resB.userId === 'u1',
      JSON.stringify(resB),
    )
    check(
      '并发 session A/B 动作不串话',
      safeParse(resA.action[0])?.type === 'move' && safeParse(resB.action[0])?.type === 'attack',
      JSON.stringify([resA.action, resB.action]),
    )
  } finally {
    conn.ws.terminate()
    await conn.fiber.dispose()
  }

  /* ---------- 场景 3a：服务端 URL 配错（连接拒绝）仅日志不阻断 ---------- */
  section('场景 3a：服务端 URL 配错（连接拒绝）→ 仅日志不阻断 AI')
  const refusedPort = await freePort()
  conn = await boot({ serverUrl: `http://127.0.0.1:${refusedPort}` })
  try {
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-srv',
        userId: 'u1',
        type: 'toggle_walker_ai',
        content: true,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    await conn.collector.next()
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-srv',
        userId: 'u1',
        type: 'chat',
        content: '服务端不可用也要返回 AI',
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    const reply = await conn.collector.next(8000)
    check('服务端连接拒绝时 AI 仍 success=true', reply.success === true, JSON.stringify(reply))
    await new Promise((r) => setTimeout(r, 1500))
    const srvFail = serverFailureMessages()
    check(
      '服务端请求失败仅记 [server] 日志',
      srvFail.length > 0,
      JSON.stringify(srvFail.map((m) => m.args)),
    )
  } finally {
    conn.ws.terminate()
    await conn.fiber.dispose()
  }

  /* ---------- 场景 3b：服务端超时仅日志不阻断 AI ---------- */
  section('场景 3b：服务端超时（>5s）→ 仅日志不阻断 AI')
  const slowPort = await freePort()
  const slowServer = createServer((_req, _res) => {
    /* 故意不响应，触发 AbortSignal.timeout(5000) */
  })
  await new Promise((resolve) => slowServer.listen(slowPort, '127.0.0.1', resolve))
  const beforeCount = messages.length
  conn = await boot({ serverUrl: `http://127.0.0.1:${slowPort}` })
  try {
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-slow',
        userId: 'u1',
        type: 'toggle_walker_ai',
        content: true,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    await conn.collector.next()
    const startedAt = Date.now()
    conn.ws.send(
      JSON.stringify({
        sessionId: 'sess-slow',
        userId: 'u1',
        type: 'chat',
        content: '服务端挂起也要返回 AI',
        timestamp: Math.floor(Date.now() / 1000),
      }),
    )
    const reply = await conn.collector.next(8000)
    const elapsed = Date.now() - startedAt
    check('服务端挂起时 AI 不被阻塞（<2s 返回）', reply.success === true && elapsed < 2000, `elapsed=${elapsed}ms`)
    await new Promise((r) => setTimeout(r, 5500))
    const srvFailSlow = serverFailureMessages(beforeCount)
    check(
      '服务端超时后记录失败日志',
      srvFailSlow.length > 0,
      JSON.stringify(srvFailSlow.map((m) => m.args)),
    )
  } finally {
    conn.ws.terminate()
    await conn.fiber.dispose()
    await new Promise((resolve) => slowServer.close(resolve))
  }

  /* ---------- billion-context 依赖不卸载/不修改 ---------- */
  section('billion-context 依赖检测（不卸载 / 不修改）')
  check('billion-context 已装 → 跳过 installBundle', pluginManager.installCalls.length === 0, JSON.stringify(pluginManager.installCalls))

  offExporter()
  console.log(`\n===== E2E SUMMARY: ${passed} passed, ${failed} failed =====`)
  if (failed > 0) {
    console.error('FAILURES:\n' + problems.map((p) => ' - ' + p).join('\n'))
    process.exit(1)
  }
}

/** 惰性加载观灵域客户端的 adaptPluginOutboundToDecision（跨仓桥接）。 */
async function loadClientBridge() {
  const hookPath = join(CLIENT_ROOT, 'tests/support/register.mjs')
  const adapterPath = join(CLIENT_ROOT, 'src/agent/pluginAdapter.ts')
  if (!existsSync(hookPath) || !existsSync(adapterPath)) {
    console.log('NOTE  客户端模块不存在，跳过客户端侧 action 提交验证')
    return null
  }
  const { resolve: clientResolve } = await import(pathToFileURL(hookPath).href)
  registerHooks({ resolve: clientResolve })
  const mod = await import(pathToFileURL(adapterPath).href)
  return { adaptPluginOutboundToDecision: mod.adaptPluginOutboundToDecision }
}

main().catch((error) => {
  console.error('E2E SCRIPT ERROR:', error)
  process.exit(2)
})
