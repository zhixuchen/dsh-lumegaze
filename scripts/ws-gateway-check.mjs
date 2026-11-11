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
 * T11 回炉：
 * 8) M1 插件总开关实际生效：enabled=false 不启动网关；isEnabled=false 帧级回 PLUGIN_DISABLED。
 * T12 回炉：
 * 9) M1 反向通路：enabled=false 启动 → volatile-update(enabled=true) 启动网关 / (false) 停止监听。
 */
import { spawnSync } from 'node:child_process'
import net from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import { WebSocket } from 'ws'
import * as plugin from '../lib/index.js'
import { getEngine, resetEngine, setEngine, unavailableEngine, ENGINE_NOT_READY } from '../lib/engine.js'
import { SETTINGS_NAMESPACE } from '../lib/config.js'
import { LumegazeLogger } from '../lib/logger.js'
import { WsGateway, readQueryToken } from '../lib/ws-server.js'

const PORT = 8790
const AUTH = 's3cr3t-sentinel-9f8e7d6c5b'

const problems = []
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) problems.push(`${name}${detail ? ` :: ${detail}` : ''}`)
}

/** 监听证据：优先 ss，macOS 回退 netstat / lsof。 */
function listenEvidence(port = PORT) {
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8' })
    return r.status === 0 ? r.stdout : ''
  }
  let out = run('ss', ['-ltn'])
  if (!out.includes(String(port))) out = run('netstat', ['-an', '-p', 'tcp'])
  if (!out.includes(String(port))) out = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
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

/** 轮询直到指定端口开始监听。 */
async function waitForListenOn(port, timeoutMs = 4000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (listenEvidence(port).includes(String(port))) return true
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return listenEvidence(port).includes(String(port))
}

/** 轮询直到指定端口不再监听（stop 异步关闭）。 */
async function waitForNotListen(port, timeoutMs = 4000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!listenEvidence(port).includes(String(port))) return true
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return !listenEvidence(port).includes(String(port))
}

/**
 * 模拟 `Loader._commitVolatile()`：先更新 volatile 引用，再以所属 fiber 过滤
 * 上下文派发 `loader/volatile-update`（paths 为路径数组的数组）。
 * 真实面板保存经 configForms → configEditor.edit → Loader.update → _commitVolatile。
 */
function commitVolatileUpdate(fiber, paths, enabledValue) {
  updateVolatile(fiber.config.enabled, { get: () => enabledValue })
  const self = Object.create(fiber.ctx)
  self[Context.filter] = (owner) => owner.fiber === fiber
  fiber.ctx.emit(self, 'loader/volatile-update', paths)
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

function openClient(headers = {}, url = `ws://127.0.0.1:${PORT}`) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers })
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

async function expectRejected(headers, label, url) {
  try {
    const ws = await openClient(headers, url)
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

  // ---- 2b) query 承载（浏览器 / Tauri WebView 无法自定义 upgrade 头）----
  const qs = `ws://127.0.0.1:${PORT}`
  const urlWithToken = `${qs}?token=${encodeURIComponent(AUTH)}`
  await expectRejected({}, 'handshake rejected when token query absent', `${qs}?foo=1`)
  await expectRejected({}, 'handshake rejected with wrong ?token=', `${qs}?token=wrong-value`)
  const viaQuery = await openClient({}, urlWithToken)
  viaQuery.terminate()
  check('handshake accepted with correct ?token=', true)
  const headerWrongQueryOk = await openClient({ 'x-lumegaze-auth': 'wrong-value' }, urlWithToken)
  headerWrongQueryOk.terminate()
  check('handshake accepted when header wrong but ?token= correct', true)
  const headerOkQueryWrong = await openClient({ 'x-lumegaze-auth': AUTH }, `${qs}?token=wrong-value`)
  headerOkQueryWrong.terminate()
  check('handshake accepted when ?token= wrong but header correct', true)
  // query 承载解析单元：百分号解码 / 多参数 / 畸形序列不抛错
  check('readQueryToken reads ?token=', readQueryToken('/?token=abc') === 'abc')
  check('readQueryToken decodes percent escapes', readQueryToken('/?token=' + encodeURIComponent('a+b c&d=e')) === 'a+b c&d=e')
  check('readQueryToken finds token among other params', readQueryToken('/?x=1&token=xyz') === 'xyz')
  check('readQueryToken returns undefined when absent', readQueryToken('/?x=1') === undefined)
  check('readQueryToken tolerates malformed percent escapes', readQueryToken('/?token=%ZZ') === '%ZZ')

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

  // ---- 9b) authSecret 为空 → 不鉴权（向后兼容，行为与之前一致）----
  const fiber3 = await ctx.plugin(plugin, {
    wsPort: PORT,
    logEnabled: true,
    authSecret: '',
    walkerAiSwitches: {},
  })
  const noAuth = await openClient({})
  noAuth.terminate()
  check('authSecret empty: handshake accepted without any carrier', true)
  const noAuthQuery = await openClient({}, `ws://127.0.0.1:${PORT}?token=anything`)
  noAuthQuery.terminate()
  check('authSecret empty: handshake accepted regardless of query', true)
  await fiber3.dispose()

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

  // ---- 12) M1 插件总开关实际生效 ----
  console.log('\n-- M1 插件总开关：enabled=false 不启动网关 + 帧级 PLUGIN_DISABLED 拦截 --')
  {
    // (a) enabled=false → apply 不启动 WS 网关（端口无监听）
    const disabledFiber = await ctx.plugin(plugin, {
      wsPort: PORT,
      logEnabled: true,
      enabled: false,
      authSecret: '',
      walkerAiSwitches: {},
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    check('enabled=false：插件不启动 WS 网关（端口未监听）', !listenEvidence().includes('8790'), listenEvidence().trim())
    await disabledFiber.dispose()
    await new Promise((resolve) => setTimeout(resolve, 150))

    // (b) 帧级守卫：网关运行但 isEnabled 恒 false → chat/game_tick 回 PLUGIN_DISABLED 且零引擎调用
    const gwPort = await new Promise((resolve, reject) => {
      const srv = net.createServer()
      srv.on('error', reject)
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address()
        srv.close(() => resolve(port))
      })
    })
    const gwEngineCalls = []
    const gwBase = { info() {}, warn() {}, error() {}, debug() {} }
    const gw = new WsGateway({
      switches: { isEnabled: () => true, set() {}, persist: async () => true, snapshot: () => ({}), clear() {} },
      sessions: { touch() {} },
      logger: new LumegazeLogger({ base: gwBase, isDetailed: () => true, secrets: () => [] }),
      authSecret: () => '',
      isEnabled: () => false,
      engine: () => ({
        chat: async (input) => {
          gwEngineCalls.push(input)
          return { text: 'x', emotion: 'normal', action: [], success: true, errorCode: '', errorMsg: '' }
        },
      }),
    })
    gw.start(gwPort)
    const gwClient = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${gwPort}`)
      const timer = setTimeout(() => {
        ws.terminate()
        reject(new Error('gw connect timeout'))
      }, 4000)
      ws.on('open', () => {
        clearTimeout(timer)
        resolve(ws)
      })
      ws.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    const gwCollector = new Collector(gwClient)
    gwClient.send(JSON.stringify({ sessionId: 's-dis', userId: 'u-dis', type: 'chat', content: 'hi', timestamp: Math.floor(Date.now() / 1000) }))
    const disChat = await gwCollector.next()
    check('isEnabled=false：chat 回 PLUGIN_DISABLED', disChat.success === false && disChat.errorCode === 'PLUGIN_DISABLED', JSON.stringify(disChat))
    check('isEnabled=false：chat 不调用引擎', gwEngineCalls.length === 0, `calls=${gwEngineCalls.length}`)
    gwClient.send(JSON.stringify({ sessionId: 's-dis', userId: 'u-dis', type: 'game_tick', content: {}, timestamp: Math.floor(Date.now() / 1000) }))
    const disTick = await gwCollector.next()
    check('isEnabled=false：game_tick 回 PLUGIN_DISABLED', disTick.success === false && disTick.errorCode === 'PLUGIN_DISABLED', JSON.stringify(disTick))
    check('isEnabled=false：game_tick 不调用引擎', gwEngineCalls.length === 0, `calls=${gwEngineCalls.length}`)
    gwClient.terminate()
    await gw.stop()
  }

  // ---- 13) M1 反向通路：enabled=false 启动 → volatile-update(true) 启动网关 / (false) 停止 ----
  console.log('\n-- M1 反向通路：运行期 enabled false→true 启动网关 / true→false 停止 --')
  {
    const P = 8791
    const reverseFiber = await ctx.plugin(plugin, {
      wsPort: P,
      logEnabled: true,
      enabled: false,
      authSecret: '',
      walkerAiSwitches: {},
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    check('reverse: enabled=false 启动后端口未监听', !listenEvidence(P).includes(String(P)), listenEvidence(P).trim())

    // 面板把 enabled 改回 true：configForms → Loader._commitVolatile → 提交引用 + 派发事件
    commitVolatileUpdate(reverseFiber, [['enabled']], true)
    const started = await waitForListenOn(P)
    check('reverse: volatile-update(enabled=true) 后网关启动并监听', started, listenEvidence(P).trim())

    // 反向：enabled=true → false → 停止监听
    commitVolatileUpdate(reverseFiber, [['enabled']], false)
    const stopped = await waitForNotListen(P)
    check('reverse: volatile-update(enabled=false) 后网关停止监听', stopped, listenEvidence(P).trim())

    // 非 enabled 路径的事件不应触发启停
    commitVolatileUpdate(reverseFiber, [['wsPort']], true)
    await new Promise((resolve) => setTimeout(resolve, 200))
    check('reverse: 非 enabled 路径的 volatile-update 不触发启停', !listenEvidence(P).includes(String(P)), listenEvidence(P).trim())

    await reverseFiber.dispose()
  }

  // ---- 14) S-4 WsGateway stop/start 关闭窗口竞态 ----
  console.log('\n-- S-4 WsGateway closing 标志防 stop/start 竞态 --')
  {
    const P1 = 8792
    const P2 = 8793
    const gw = new WsGateway({
      switches: { isEnabled: () => true, set() {}, persist: async () => true, snapshot: () => ({}), clear() {} },
      sessions: { touch() {} },
      logger: new LumegazeLogger({
        base: { info() {}, warn() {}, error() {}, debug() {} },
        isDetailed: () => true,
        secrets: () => [],
      }),
      authSecret: () => '',
      engine: () => ({
        chat: async () => ({ text: 'x', emotion: 'normal', action: [], success: true, errorCode: '', errorMsg: '' }),
      }),
    })
    gw.start(P1)
    check('S-4: start(P1) 后监听', await waitForListenOn(P1))
    check('S-4: isRunning()=true', gw.isRunning() === true)
    check('S-4: isClosing()=false', gw.isClosing() === false)

    // 不 await stop()，立即在关闭窗口内 start(P2)
    const stopPromise = gw.stop()
    check('S-4: stop() 置 closing 标志', gw.isClosing() === true)
    check('S-4: 关闭窗口内 isRunning()=false', gw.isRunning() === false)
    gw.start(P2)
    check('S-4: 关闭窗口内 start(P2) 不新建实例（isRunning=false）', gw.isRunning() === false)

    await stopPromise
    check('S-4: stop() 完成后清除 closing', gw.isClosing() === false)
    check('S-4: 关闭完成后补启延迟 start(P2)', await waitForListenOn(P2), listenEvidence(P2).trim())
    check('S-4: 补启后 isRunning()=true', gw.isRunning() === true)
    check('S-4: 旧端口 P1 已释放', !listenEvidence(P1).includes(String(P1)))

    // dispose 路径：关闭窗口内记录的延迟 start 不再补启
    const disposePromise = gw.dispose()
    gw.start(P1)
    check('S-4: dispose 关闭窗口内 start(P1) 不新建实例', gw.isRunning() === false)
    await disposePromise
    await new Promise((resolve) => setTimeout(resolve, 200))
    check('S-4: dispose 后不补启延迟 start', !listenEvidence(P1).includes(String(P1)))
    check('S-4: dispose 后 isRunning()=false', gw.isRunning() === false)

    // T17 S-4 加固：dispose 已完成后再 start 也不得「复活」网关
    gw.start(P1)
    check('S-4: dispose 完成后 start(P1) 不复活（isRunning=false）', gw.isRunning() === false)
    await new Promise((resolve) => setTimeout(resolve, 200))
    check('S-4: dispose 完成后 start(P1) 端口仍未监听', !listenEvidence(P1).includes(String(P1)), listenEvidence(P1).trim())
  }

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
