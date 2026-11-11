#!/usr/bin/env node
/**
 * T4 配置面板验证脚本。
 *
 * 覆盖完成定义中的代码证据与可运行逻辑：
 * 1) inject 含 slots/locale/configForms，面板注册链路完整；
 * 2) 面板覆盖规格第五章 7 项；
 * 3) URL 格式校验（空值清空 / http(s):// 合法 / 其余非法）；
 * 4) locale 中英文案键集一致；
 * 5) Config 增补字段与 host 状态发布 / getSwitches 导出。
 * T11 回炉：
 * 6) M3 authSecret 面板入口（SettingsSecretField + path ["authSecret"] 原子写）。
 *
 * 只读脚本：不修改任何文件。退出码 0 = 全部通过。
 */
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NS, en, zh } from '../lib/client/locales.js'
import { parseServerUrlDraft } from '../lib/client/server-url.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// primitives 主入口在 Node 下不可加载（宿主依赖 + CSS modules），把控制器用到的
// 三个符号重定向到忠实移植的瘦替身；控制器类本身仍是真实编译产物。
registerHooks({
  resolve: (specifier, context, nextResolve) => {
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        url: pathToFileURL(join(root, 'scripts', '_settings-form-shim.mjs')).href,
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { LumegazeCardController } = await import('../lib/client/lumegaze-card-controller.js')

let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ok   ${name}`)
  } else {
    failed += 1
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function read(relative) {
  return readFileSync(join(root, relative), 'utf8')
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

console.log('[1] 浏览器半注册链路 (src/client.ts)')
const clientSrc = read('src/client.ts')
check(
  "inject 含 slots/locale/configForms/remote/remote.pluginManager",
  /inject:\s*string\[\]\s*=\s*\['slots',\s*'locale',\s*'configForms',\s*'remote',\s*'remote\.pluginManager'\]/.test(clientSrc),
)
check('ctx.locale.register(NS, { zh, en })', /ctx\.locale\.register\(NS,\s*\{\s*zh,\s*en\s*\}\)/.test(clientSrc))
check('ctx.configForms.get("lumegaze")', /ctx\.configForms\.get<[^>]*>\('lumegaze'\)/.test(clientSrc))
check('ctx.configForms.whileServed(["lumegaze"])', /ctx\.configForms\.whileServed\(\['lumegaze'\]/.test(clientSrc))
check('ctx.slots.inject("plugins.item")', /ctx\.slots\.inject\('plugins\.item'/.test(clientSrc))
check('ctx.slots.register(...)', /ctx\.slots\.register\(/.test(clientSrc))
check('locale NS = settings.lumegaze', NS === 'settings.lumegaze')

console.log('[2] 面板覆盖规格第五章 7 项 (src/client/LumegazeCard.tsx)')
const cardSrc = read('src/client/LumegazeCard.tsx')
const panelItems = [
  ['1 插件总开关', /pluginToggle/],
  ['2 WebSocket 端口', /wsPort/],
  ['3 服务端 URL + 校验', /serverUrl/],
  ['4 行者人设 Prompt 多行', /personaPrompt/],
  ['5 记忆模式状态', /memoryMode/],
  ['5 依赖状态', /billionStatus/],
  ['6 用户开关只读列表', /switches/],
  ['7 日志开关', /logEnabled/],
]
for (const [name, re] of panelItems) {
  check(name, re.test(cardSrc))
}
check('空/加载/错误三态', /state\.status === 'loading'|state\.status === 'unavailable'/.test(cardSrc))
check('空开关列表引导', /switchesEmpty/.test(cardSrc))
check('超长 Prompt 用 textarea', /<textarea/.test(cardSrc))

console.log('[3] URL 格式校验 (lib/client/server-url.js)')
check('空值 → clear', deepEqual(parseServerUrlDraft(''), { kind: 'clear' }))
check('http:// → set', deepEqual(parseServerUrlDraft('http://127.0.0.1:8787'), { kind: 'set', value: 'http://127.0.0.1:8787' }))
check('https:// → set', deepEqual(parseServerUrlDraft('https://example.com/api'), { kind: 'set', value: 'https://example.com/api' }))
check('去首尾空白', deepEqual(parseServerUrlDraft('  https://a.b  '), { kind: 'set', value: 'https://a.b' }))
check('ftp:// → 非法', parseServerUrlDraft('ftp://example.com') === undefined)
check('裸域名 → 非法', parseServerUrlDraft('example.com') === undefined)
check('ws:// → 非法', parseServerUrlDraft('ws://example.com') === undefined)
check('非法值不落盘（parse 返回 undefined）', parseServerUrlDraft('not-a-url') === undefined)

console.log('[4] locale 中英文案键集一致')
const zhKeys = Object.keys(zh).sort()
const enKeys = Object.keys(en).sort()
check('zh / en 键集一致', deepEqual(zhKeys, enKeys), `zh-only=${JSON.stringify(zhKeys.filter((k) => !enKeys.includes(k)))}`)
check('无空文案', zhKeys.every((key) => typeof zh[key] === 'string' && zh[key].length > 0))
check('无空英文案', enKeys.every((key) => typeof en[key] === 'string' && en[key].length > 0))

console.log('[5] Config 增补字段与 host 状态发布')
const configSrc = read('src/config.ts')
check('Config.enabled volatile', /enabled:\s*z\.boolean\(\)\.volatile\(\)/.test(configSrc))
check('Config.memoryMode volatile', /memoryMode:\s*z\.string\(\)\.volatile\(\)/.test(configSrc))
check('Config.billionStatus volatile', /billionStatus:\s*z\.string\(\)\.volatile\(\)/.test(configSrc))
const indexSrc = read('src/index.ts')
check('导出 getSwitches()', /export function getSwitches\(\)/.test(indexSrc))
check('导出 getMemoryMode()', /export function getMemoryMode\(\)/.test(indexSrc))
check('导出 getDependencyStatus()', /export function getDependencyStatus\(\)/.test(indexSrc))
check('publishRuntimeStatus 写 memoryMode', /path:\s*\['memoryMode'\]/.test(indexSrc))
check('publishRuntimeStatus 写 billionStatus', /path:\s*\['billionStatus'\]/.test(indexSrc))
check('关闭自动生成表单', /configure\?\.\(\{ auto: false \}\)/.test(indexSrc))

console.log('[6] M3 authSecret 面板入口（绑定 volatile 字段）')
const controllerSrc = read('src/client/lumegaze-card-controller.ts')
check('LumegazeSettings 含 authSecret', /authSecret\?:\s*string/.test(controllerSrc))
check('SettingsSecretSpec 绑定 authSecret', /field:\s*'authSecret'/.test(controllerSrc))
check('保存时原子写 path: ["authSecret"]', /path:\s*\['authSecret'\]/.test(controllerSrc))
check('面板使用 SettingsSecretField', /SettingsSecretField/.test(cardSrc))
check('面板绑定 state.authSecret.text', /state\.authSecret\.text/.test(cardSrc))
check('locale 含 authSecret 文案', 'authSecret' in zh && 'authSecret' in en && 'authSecretHint' in zh && 'authSecretHint' in en)

/** 构造 SettingsFormScope 的最小 mock：快照 + 订阅 + revision 栅栏的 mutate。 */
function makeSecretScope(initialValue) {
  const state = { value: initialValue, revision: 4 }
    const mutateOps = []
    const listeners = []
    return {
      state,
      mutateOps,
      getSnapshot: () => ({
        status: 'ready',
        value: state.value,
        base: {},
        user: {},
        writable: true,
        revision: state.revision,
      }),
      subscribe: (fn) => {
        listeners.push(fn)
        return () => {
          const index = listeners.indexOf(fn)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
      mutate: async (ops, expectedRevision) => {
        mutateOps.push({ ops, expectedRevision })
        for (const op of ops) {
          if (op.op === 'set' && op.path[0] === 'authSecret') {
            state.value = { ...state.value, authSecret: op.value }
          }
        }
        state.revision += 1
        for (const listener of [...listeners]) listener()
        return true
      },
    }
}

console.log('[6] M3 authSecret 面板配置入口 (LumegazeCardController)')
{
  // 6.1 已配置密钥：state 含字段、草稿不回显明文
  const scope = makeSecretScope({ authSecret: 'existing-secret', walkerAiSwitches: {} })
  const controller = new LumegazeCardController(scope)
  const face = controller.inject()
  if (process.env.DEBUG_M3) console.log('DEBUG face=', JSON.stringify(Object.keys(face)), 'hooks=', face.hooks)
  const hooks = face.hooks
  if (process.env.DEBUG_M3) {
    console.log('DEBUG hooks desc=', JSON.stringify(Object.getOwnPropertyDescriptor(face, 'hooks')))
    console.log('DEBUG hooks keys=', JSON.stringify(Object.keys(hooks)))
    console.log('DEBUG lumagaze desc=', JSON.stringify(Object.getOwnPropertyDescriptor(hooks, 'lumagazeCard')))
    console.log('DEBUG direct1=', hooks.lumegazeCard)
    console.log('DEBUG direct2=', hooks.lumegazeCard)
    console.log('DEBUG ctorStore=', controller.store)
  }
  const store = hooks.lumegazeCard
  if (process.env.DEBUG_M3) console.log('DEBUG store=', typeof store, store && Object.keys(store))
  const state = store.getSnapshot()

  check('state 含 authSecret 字段状态', 'authSecret' in state && typeof state.authSecret === 'object')
  check('state 含 authSecretConfigured 布尔', typeof state.authSecretConfigured === 'boolean')
  check('已配置密钥时 authSecretConfigured=true', state.authSecretConfigured === true)
  check('write-only：草稿初始为空（不回显明文）', state.authSecret.text === '')
  check('state 序列化不含已存密钥明文', !JSON.stringify(state).includes('existing-secret'))

  // 6.2 保存经 configForms 原子写 authSecret
  face.edit('authSecret', 'new-secret-123')
  await controller.form.save()
  const secretWrite = scope.mutateOps.find(
    (entry) => entry.ops.some((op) => op.op === 'set' && op.path[0] === 'authSecret'),
  )
  check('保存经 configForms 原子写 authSecret', Boolean(secretWrite))
  check(
    '写入值等于暂存文本',
    secretWrite?.ops.find((op) => op.path[0] === 'authSecret')?.value === 'new-secret-123',
  )
  check('写入带快照 revision 栅栏', secretWrite?.expectedRevision === 4)

  const after = face.hooks.lumegazeCard.getSnapshot()
  check('保存后 authSecretConfigured=true', after.authSecretConfigured === true)
  check('保存后仍不回显密钥明文', after.authSecret.text === '' && !JSON.stringify(after).includes('new-secret-123'))
  controller.dispose()

  // 6.3 空密钥 → 未配置标签
  const emptyScope = makeSecretScope({ authSecret: '', walkerAiSwitches: {} })
  const emptyController = new LumegazeCardController(emptyScope)
  const emptyState = emptyController.inject().hooks.lumegazeCard.getSnapshot()
  check('空密钥时 authSecretConfigured=false', emptyState.authSecretConfigured === false)
  emptyController.dispose()

  // 6.4 空白草稿保存不覆盖既有密钥（write-only 语义）
  const keepScope = makeSecretScope({ authSecret: 'keep-me', walkerAiSwitches: {} })
  const keepController = new LumegazeCardController(keepScope)
  const keepFace = keepController.inject()
  const opsBefore = keepScope.mutateOps.length
  keepFace.edit('authSecret', '   ')
  await keepController.form.save()
  check('空白 secret 草稿不写（保留既有密钥）', keepScope.mutateOps.length === opsBefore)
  check(
    '既有密钥仍被识别为已配置',
    keepFace.hooks.lumegazeCard.getSnapshot().authSecretConfigured === true,
  )
  keepController.dispose()
}

console.log('[7] S-M1-2 宿主级启停 (LumegazeCardController -> pluginManager.setPluginEnabled)')
{
  /** 记录调用的 remote.pluginManager 替身；behavior 决定返回值。 */
  function makePluginManager(behavior) {
    const calls = []
    return {
      calls,
      setPluginEnabled: async (id, enabled) => {
        calls.push({ id, enabled })
        return behavior(id, enabled)
      },
    }
  }

  // 7.1 成功路径：断言 entry id 与 enabled 参数
  const okManager = makePluginManager(() => ({ ok: true, value: { changed: true, application: 'applied' } }))
  const okController = new LumegazeCardController(makeSecretScope({ enabled: true, walkerAiSwitches: {} }), okManager)
  const okFace = okController.inject()
  check('setPluginEnabled 动作存在', typeof okFace.setPluginEnabled === 'function')
  check('setPluginEnabled(true) 返回 true', (await okFace.setPluginEnabled(true)) === true)
  check(
    'setPluginEnabled(true) 以 lumagaze/true 调用 remote',
    okManager.calls.length === 1 && okManager.calls[0].id === 'lumegaze' && okManager.calls[0].enabled === true,
    JSON.stringify(okManager.calls),
  )
  check('setPluginEnabled(false) 返回 true', (await okFace.setPluginEnabled(false)) === true)
  check(
    'setPluginEnabled(false) 以 lumagaze/false 调用 remote',
    okManager.calls.length === 2 && okManager.calls[1].id === 'lumegaze' && okManager.calls[1].enabled === false,
    JSON.stringify(okManager.calls),
  )
  okController.dispose()

  // 7.2 失败路径：remote 返回 { ok: false }
  const refusedManager = makePluginManager(() => ({ ok: false, error: { code: 'stop-profile' } }))
  const refusedController = new LumegazeCardController(
    makeSecretScope({ enabled: true, walkerAiSwitches: {} }),
    refusedManager,
  )
  check('remote 拒绝时返回 false', (await refusedController.inject().setPluginEnabled(false)) === false)
  refusedController.dispose()

  // 7.3 失败路径：remote 抛错
  const throwingController = new LumegazeCardController(
    makeSecretScope({ enabled: true, walkerAiSwitches: {} }),
    { setPluginEnabled: async () => { throw new Error('transport down') } },
  )
  check('remote 抛错时返回 false 且不崩溃', (await throwingController.inject().setPluginEnabled(true)) === false)
  throwingController.dispose()

  // 7.4 失败路径：remote 未注入（降级为插件内开关兜底）
  const noRemoteController = new LumegazeCardController(makeSecretScope({ enabled: true, walkerAiSwitches: {} }))
  check('remote 未注入时返回 false（兜底）', (await noRemoteController.inject().setPluginEnabled(true)) === false)
  noRemoteController.dispose()

  // 7.5 失败路径：application 非 applied（restart-required / overridden / cancelled / failed）
  // T17 S-M1-2：成功语义收紧为解包 value.application，仅 'applied' 算成功。
  for (const application of ['restart-required', 'overridden', 'cancelled', 'failed']) {
    const manager = makePluginManager(() => ({ ok: true, value: { application } }))
    const controller = new LumegazeCardController(makeSecretScope({ enabled: true, walkerAiSwitches: {} }), manager)
    check(`application=${application} 返回 false`, (await controller.inject().setPluginEnabled(true)) === false)
    controller.dispose()
  }

  // 7.6 失败路径：ok=true 但 value.application 缺失 / value 缺失
  {
    const missingManager = makePluginManager(() => ({ ok: true, value: {} }))
    const missingController = new LumegazeCardController(makeSecretScope({ enabled: true, walkerAiSwitches: {} }), missingManager)
    check('ok=true 但 application 缺失返回 false', (await missingController.inject().setPluginEnabled(true)) === false)
    missingController.dispose()
  }
  {
    const noValueManager = makePluginManager(() => ({ ok: true }))
    const noValueController = new LumegazeCardController(makeSecretScope({ enabled: true, walkerAiSwitches: {} }), noValueManager)
    check('ok=true 但 value 缺失返回 false', (await noValueController.inject().setPluginEnabled(true)) === false)
    noValueController.dispose()
  }

  // 7.7 失败路径：返回值非对象（契约异常）
  for (const bad of [undefined, null, 'applied', 42, true]) {
    const badManager = makePluginManager(() => bad)
    const badController = new LumegazeCardController(makeSecretScope({ enabled: true, walkerAiSwitches: {} }), badManager)
    check(`非对象结果 ${String(JSON.stringify(bad))} 返回 false`, (await badController.inject().setPluginEnabled(true)) === false)
    badController.dispose()
  }
}

console.log('[8] S-M1-2 面板 / client 接线与文案')
{
  const cardSrc2 = read('src/client/LumegazeCard.tsx')
  check('面板总开关开启调用 props.setPluginEnabled(true)', /props\.setPluginEnabled\(true\)/.test(cardSrc2))
  check('面板禁用确认调用 props.setPluginEnabled(false)', /props\.setPluginEnabled\(false\)/.test(cardSrc2))
  check('面板禁用前有确认文案', /pluginToggleDisableConfirm/.test(cardSrc2))
  check('client.ts 传入 ctx.remote?.pluginManager', /ctx\.remote\?\.pluginManager/.test(clientSrc))
  check('client.ts inject 含 remote', /'remote'/.test(clientSrc))
  check(
    'locale 含 pluginToggleDisableConfirm/confirmDisable/cancel',
    'pluginToggleDisableConfirm' in zh &&
      'pluginToggleDisableConfirm' in en &&
      'confirmDisable' in zh &&
      'confirmDisable' in en &&
      'cancel' in zh &&
      'cancel' in en,
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
