/**
 * S2 WebSocket 网关端到端验证（覆盖任务完成定义 1-5）。
 *
 * 运行：node scripts/ws-gateway-check.mjs
 *
 * 覆盖：
 * 1) 只监听 127.0.0.1:8790（无 0.0.0.0）—— macOS 无 `ss`，等价证据用 lsof/netstat。
 * 2) toggle=false 后再 chat → WALKER_AI_DISABLED，且引擎调用计数不变。
 * 3) 两个 sessionId 并发不串话；userId 开关互不影响。
 * 4) 非法 JSON / 空 userId / 非法 type / 超大帧被拒且服务不崩溃。
 * 5) 日志五类齐全且不含 authSecret 明文（含脱敏器单测）。
 * 6) 开关经 ctx.settings.mutate 持久化；重新加载插件后开关状态保留。
 * 7) engine 接口 + setEngine 接缝可注入。
 */
import { spawnSync } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import { WebSocket } from 'ws'
import * as plugin from '../lib/index.js'
import { getEngine, resetEngine, setEngine, unavailableEngine, ENGINE_NOT_READY } from '../lib/engine.js'
import { SETTINGS_NAMESPACE } from '../lib/config.js'
import { LumegazeLogger } from '../lib/logger.js'

const PORT = 8790
const AUTH = 's3cr3t-sentinel-9f8e7d6c5b'

const problems = []
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) problems.push(`${name}${detail ? ` :: ${detail}` : ''}`)
}

/** 监听证据：优先 ss，macOS 回退 netstat / lsof。 */
function listenEvidence() {
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8' })
    return r.status === 0 ? r.stdout : ''
  }
  let out = run('ss', ['-ltn'])
  if (!out.includes('8790')) out = run('netstat', ['-an', '-p', 'tcp'])
  if (!out.includes('8790')) out = run('lsof', ['-nP', '-iTCP:8790', '-sTCP:LISTEN'])
  return out
}

/** 轮询监听证据直到端口就绪（net.listen 绑定是异步的）。 */
async function waitForListen(timeoutMs = 4000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const out = listenEvidence()
    if (out.includes('8790')) return out
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return listenEvidence()
}

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
  next(timeoutMs = 4000) {
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

function openClient(headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers })
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error('connect timeout'))
    }, 4000)
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

async function expectRejected(headers, label) {
  try {
    const ws = await openClient(headers)
    ws.terminate()
    check(label, false, 'handshake unexpectedly accepted')
  } catch {
    check(label, true)
  }
}

const messages = []
const ctx = new Context()
const offExporter = ctx.logger.exporter({ export: (message) => messages.push(message) })

// ---- mock ctx.settings：记录 mutate，模拟 profile patch 持久化 ----
const persisted = { value: {} }
const settingsOps = []
ctx.provide('settings', {
  describe: () => [{ ns: SETTINGS_NAMESPACE, revision: 7 }],
  mutate: async (ns, ops, revision) => {
    settingsOps.push({ ns, ops, revision })
    for (const op of ops) {
      if (op.op === 'set' && op.path[0] === 'walkerAiSwitches') persisted.value = { ...op.value }
    }
  },
})

// ---- spy engine：计数 + echo，验证引擎接缝 ----
const engineCalls = []
const spyEngine = {
  async chat(input) {
    engineCalls.push(input)
    const text = typeof input.content === 'string' ? `echo:${input.content}` : 'echo:tick'
    return { text, emotion: 'happy', action: ['wave'], success: true, errorCode: '', errorMsg: '' }
  },
}

async function main() {
  // 预检端口占用
  const pre = listenEvidence()
  if (pre.includes('8790')) {
    console.error('PORT 8790 already in use before test:\n' + pre)
    process.exit(2)
  }

  const fiber = await ctx.plugin(plugin, {
    wsPort: PORT,
    logEnabled: true,
    authSecret: AUTH,
    walkerAiSwitches: {},
  })
  check('plugin applies without required settings inject', true)
  check('plugin exposes setEngine seam', typeof plugin.setEngine === 'function')
  check('plugin inject stays empty (no inject/permission expansion)', plugin.inject.length === 0)
  setEngine(spyEngine)
  check('setEngine injects spy engine', getEngine() === spyEngine)
  const notReady = await unavailableEngine.chat({ sessionId: 's', userId: 'u', content: 'x', type: 'chat' })
  check('unavailableEngine returns ENGINE_NOT_READY', notReady.success === false && notReady.errorCode === ENGINE_NOT_READY)

  // ---- 1) 监听地址 ----
  const ss = await waitForListen()
  check('listens on 127.0.0.1:8790', /127\.0\.0\.1[:.]8790/.test(ss), ss.trim().split('\n').find((l) => l.includes('8790')) ?? 'no line')
  check('no 0.0.0.0:8790 binding', !/0\.0\.0\.0[:.]8790/.test(ss))

  // ---- 2) 握手鉴权 ----
  await expectRejected({}, 'handshake rejected when authSecret set & header missing')
  await expectRejected({ 'x-lumegaze-auth': 'wrong-value' }, 'handshake rejected with wrong auth')
  const alice = await openClient({ 'x-lumegaze-auth': AUTH })
  const bob = await openClient({ 'x-lumegaze-auth': AUTH })
  const aliceC = new Collector(alice)
  const bobC = new Collector(bob)
  check('handshake accepted with correct x-lumegaze-auth', true)

  // ---- 3) 开关关闭 → 拦截，引擎零调用 ----
  alice.send(JSON.stringify({ sessionId: 's-off', userId: 'u-off', type: 'toggle_walker_ai', content: false, timestamp: Math.floor(Date.now() / 1000) }))
  const offToggle = await aliceC.next()
  check('toggle off returns success', offToggle.success === true, JSON.stringify(offToggle))
  const callsBefore = engineCalls.length
  alice.send(JSON.stringify({ sessionId: 's-off', userId: 'u-off', type: 'chat', content: 'hello', timestamp: Math.floor(Date.now() / 1000) }))
  const offChat = await aliceC.next()
  check('disabled chat success=false', offChat.success === false, JSON.stringify(offChat))
  check('disabled chat errorCode=WALKER_AI_DISABLED', offChat.errorCode === 'WALKER_AI_DISABLED', offChat.errorCode)
  check('disabled chat errorMsg exact', offChat.errorMsg === '行者AI能力未开启，请先打开开关', offChat.errorMsg)
  check('disabled chat does not call engine', engineCalls.length === callsBefore, `calls ${callsBefore}->${engineCalls.length}`)

  // ---- 4) 开关开启 → 调用引擎，成功返回 ----
  alice.send(JSON.stringify({ sessionId: 's-on', userId: 'u-on', type: 'toggle_walker_ai', content: true, timestamp: Math.floor(Date.now() / 1000) }))
  const onToggle = await aliceC.next()
  check('toggle on returns success', onToggle.success === true)
  alice.send(JSON.stringify({ sessionId: 's-on', userId: 'u-on', type: 'chat', content: 'hello-on', timestamp: Math.floor(Date.now() / 1000) }))
  const onChat = await aliceC.next()
  check('enabled chat success=true', onChat.success === true, JSON.stringify(onChat))
  check('enabled chat echoes engine text', onChat.text === 'echo:hello-on', onChat.text)
  check('enabled chat emotion/action pass-through', onChat.emotion === 'happy' && JSON.stringify(onChat.action) === '["wave"]')
  check('enabled chat calls engine once', engineCalls.length === callsBefore + 1)

  // ---- 5) 并发会话隔离 + userId 开关互不影响 ----
  // 先开启两个用户开关，再制造并发交叉
  alice.send(JSON.stringify({ sessionId: 's-A', userId: 'u-a', type: 'toggle_walker_ai', content: true, timestamp: Math.floor(Date.now() / 1000) }))
  await aliceC.next()
  bob.send(JSON.stringify({ sessionId: 's-B', userId: 'u-b', type: 'toggle_walker_ai', content: true, timestamp: Math.floor(Date.now() / 1000) }))
  await bobC.next()

  const pA = aliceC.next()
  alice.send(JSON.stringify({ sessionId: 's-A', userId: 'u-a', type: 'chat', content: 'A-content', timestamp: Math.floor(Date.now() / 1000) }))
  const pB = bobC.next()
  bob.send(JSON.stringify({ sessionId: 's-B', userId: 'u-b', type: 'chat', content: 'B-content', timestamp: Math.floor(Date.now() / 1000) }))
  const [resA, resB] = await Promise.all([pA, pB])
  check('concurrent session A keeps own sessionId/userId', resA.sessionId === 's-A' && resA.userId === 'u-a', JSON.stringify(resA))
  check('concurrent session B keeps own sessionId/userId', resB.sessionId === 's-B' && resB.userId === 'u-b', JSON.stringify(resB))
  check('concurrent session A text not crossed', resA.text === 'echo:A-content', resA.text)
  check('concurrent session B text not crossed', resB.text === 'echo:B-content', resB.text)

  // 开关隔离：u-a 关闭，u-b 保持开启
  alice.send(JSON.stringify({ sessionId: 's-A', userId: 'u-a', type: 'toggle_walker_ai', content: false, timestamp: Math.floor(Date.now() / 1000) }))
  await aliceC.next()
  const callsBeforeIso = engineCalls.length
  alice.send(JSON.stringify({ sessionId: 's-A', userId: 'u-a', type: 'chat', content: 'a', timestamp: Math.floor(Date.now() / 1000) }))
  const isoA = await aliceC.next()
  bob.send(JSON.stringify({ sessionId: 's-B', userId: 'u-b', type: 'chat', content: 'b', timestamp: Math.floor(Date.now() / 1000) }))
  const isoB = await bobC.next()
  check('u-a off chat intercepted', isoA.errorCode === 'WALKER_AI_DISABLED')
  check('u-b on chat still succeeds (switch isolation)', isoB.success === true && isoB.userId === 'u-b')
  const isoNewCalls = engineCalls.slice(callsBeforeIso)
  check(
    'u-a intercept did not call engine; only u-b did',
    isoNewCalls.length === 1 && isoNewCalls[0].userId === 'u-b',
    JSON.stringify(isoNewCalls),
  )

  // ---- 6) 非法输入 ----
  alice.send('{not-valid-json')
  const badJson = await aliceC.next()
  check('invalid JSON rejected', badJson.success === false && badJson.errorCode === 'INVALID_JSON', JSON.stringify(badJson))
  alice.send(JSON.stringify({ sessionId: 's-x', userId: '', type: 'chat', content: 'x' }))
  const emptyUser = await aliceC.next()
  check('empty userId rejected', emptyUser.errorCode === 'INVALID_MESSAGE', emptyUser.errorCode)
  alice.send(JSON.stringify({ sessionId: '', userId: 'u-on', type: 'chat', content: 'x' }))
  const emptySession = await aliceC.next()
  check('empty sessionId rejected', emptySession.errorCode === 'INVALID_MESSAGE', emptySession.errorCode)
  alice.send(JSON.stringify({ sessionId: 's-x', userId: 'u-on', type: 'bogus', content: 'x' }))
  const badType = await aliceC.next()
  check('unsupported type rejected', badType.errorCode === 'UNSUPPORTED_TYPE', badType.errorCode)
  // 服务仍存活
  alice.send(JSON.stringify({ sessionId: 's-on', userId: 'u-on', type: 'chat', content: 'after-bad', timestamp: Math.floor(Date.now() / 1000) }))
  const alive = await aliceC.next()
  check('server survives invalid frames', alive.success === true, JSON.stringify(alive))

  // ---- 7) 超大帧 ----
  const big = await openClient({ 'x-lumegaze-auth': AUTH })
  const closedCode = await new Promise((resolve) => {
    let done = false
    const finish = (code) => {
      if (!done) {
        done = true
        resolve(code)
      }
    }
    big.on('close', (code) => finish(code))
    big.on('error', () => finish(1006))
    setTimeout(() => finish(-1), 4000)
    big.send(JSON.stringify({ sessionId: 's-big', userId: 'u-on', type: 'chat', content: 'x'.repeat(300 * 1024), timestamp: Math.floor(Date.now() / 1000) }))
  })
  big.terminate()
  check('oversized frame closes connection', closedCode !== -1, `closeCode=${closedCode}`)
  alice.send(JSON.stringify({ sessionId: 's-on', userId: 'u-on', type: 'chat', content: 'after-big', timestamp: Math.floor(Date.now() / 1000) }))
  const afterBig = await aliceC.next()
  check('server survives oversized frame', afterBig.success === true, JSON.stringify(afterBig))

  // ---- 8) 持久化 ----
  const switchMutate = settingsOps.find(
    (op) => op.ns === SETTINGS_NAMESPACE && op.ops.some((o) => o.op === 'set' && o.path[0] === 'walkerAiSwitches'),
  )
  check('switch persisted via ctx.settings.mutate', Boolean(switchMutate), `${settingsOps.length} ops`)
  check('persisted snapshot has u-on=true', persisted.value['u-on'] === true, JSON.stringify(persisted.value))
  check('persisted snapshot has u-a=false', persisted.value['u-a'] === false, JSON.stringify(persisted.value))

  // ---- 9) 重启保留（模拟 DSH 重启：dispose 后用持久化快照重新加载）----
  await fiber.dispose()
  const fiber2 = await ctx.plugin(plugin, {
    wsPort: PORT,
    logEnabled: true,
    authSecret: AUTH,
    walkerAiSwitches: persisted.value,
  })
  resetEngine()
  setEngine(spyEngine)
  const restarted = await openClient({ 'x-lumegaze-auth': AUTH })
  const restartedC = new Collector(restarted)
  const callsBeforeRestart = engineCalls.length
  restarted.send(JSON.stringify({ sessionId: 's-restart', userId: 'u-on', type: 'chat', content: 'restart', timestamp: Math.floor(Date.now() / 1000) }))
  const restartOn = await restartedC.next()
  check('restart: u-on switch retained, chat succeeds', restartOn.success === true, JSON.stringify(restartOn))
  check('restart: engine invoked for retained switch', engineCalls.length === callsBeforeRestart + 1)
  restarted.send(JSON.stringify({ sessionId: 's-restart', userId: 'u-a', type: 'chat', content: 'restart', timestamp: Math.floor(Date.now() / 1000) }))
  const restartOff = await restartedC.next()
  check('restart: u-a=false retained, chat intercepted', restartOff.errorCode === 'WALKER_AI_DISABLED', JSON.stringify(restartOff))
  await fiber2.dispose()

  // ---- 10) 日志分级 + 脱敏 ----
  const formatted = messages.map((m) => String(m.args?.[0] ?? ''))
  const categories = ['connection', 'switch', 'inference', 'dependency', 'server']
  for (const cat of categories) {
    check(`log category [${cat}] present`, formatted.some((f) => f.includes(`[${cat}]`)))
  }
  const logDump = JSON.stringify(messages)
  check('no authSecret plaintext in logs', !logDump.includes(AUTH))
  check('no 0.0.0.0 referenced in logs', !logDump.includes('0.0.0.0'))

  // 脱敏器单测：故意把密钥放进格式串与参数
  const scrubbed = []
  const fakeBase = {
    info: (format, ...params) => scrubbed.push([format, params]),
    warn: (format, ...params) => scrubbed.push([format, params]),
    error: (format, ...params) => scrubbed.push([format, params]),
    debug: (format, ...params) => scrubbed.push([format, params]),
  }
  const llogger = new LumegazeLogger({ base: fakeBase, isDetailed: () => true, secrets: () => [AUTH] })
  llogger.info('connecting with secret %s', AUTH)
  llogger.connection(`token=${AUTH} end`)
  const scrubDump = JSON.stringify(scrubbed)
  check('logger scrubs authSecret from params', !scrubDump.includes(AUTH))
  check('logger scrubs authSecret from format', scrubDump.includes('***'))

  // ---- 11) 不输出 token 形态 ----
  const tokenLogger = new LumegazeLogger({ base: fakeBase, isDetailed: () => true, secrets: () => [] })
  tokenLogger.connection('Authorization: Bearer abcdef123456')
  const tokenDump = JSON.stringify(scrubbed)
  check('logger scrubs authorization header value', /authorization:\*\*\*/i.test(tokenDump) && !/abcdef123456/.test(tokenDump))

  await new Promise((resolve) => setTimeout(resolve, 50))
}

try {
  await main()
} catch (error) {
  console.error('E2E HARNESS ERROR:', error)
  problems.push(`harness error: ${error?.message ?? error}`)
}

offExporter()
resetEngine()

if (problems.length) {
  console.error('\nWS GATEWAY CHECK FAILED:\n' + problems.map((p) => ' - ' + p).join('\n'))
  process.exit(1)
}
console.log('\nWS GATEWAY CHECK PASSED: all S2 acceptance criteria verified')
process.exit(0)
