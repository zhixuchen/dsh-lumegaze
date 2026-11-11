/**
 * Lumegaze 配置面板的暂存表单控制器。
 *
 * 与官方 shell 面板一致：`SettingsFormModel` 把用户输入暂存为草稿，只有「保存」
 * 才经 `configForms` 做一次带 revision 的原子写。运行期状态（记忆模式 / 依赖状态 /
 * 用户开关表）不参与暂存，直接从同一 namespace 的快照读取，因此 toggle 变化会
 * 实时反映到面板。
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  SettingsFormModel,
  settingsNumberField,
  settingsTextField,
  type SettingsFieldSpec,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormScope,
  type SettingsFormShell,
  type SettingsSecretSpec,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** 本插件 settings namespace `lumegaze` 的可编辑 / 只读字段。 */
export interface LumegazeSettings {
  enabled?: boolean
  wsPort?: number
  serverUrl?: string
  personaPrompt?: string
  /** M3：插件 WS 握手鉴权密钥（与客户端 token 输入框对应）。 */
  authSecret?: string
  logEnabled?: boolean
  walkerAiSwitches?: Record<string, boolean>
  memoryMode?: string
  billionStatus?: string
}

/** 用户开关只读列表的一行。 */
export interface WalkerSwitchRow {
  userId: string
  enabled: boolean
}

/** 面板渲染所需的全部状态。 */
export interface LumegazeCardState extends SettingsFormShell {
  /** namespace 同步状态：加载中 / 就绪 / 不可用。 */
  status: 'loading' | 'ready' | 'unavailable'
  enabled: SettingsFieldState
  wsPort: SettingsFieldState
  serverUrl: SettingsFieldState
  personaPrompt: SettingsFieldState
  /** M3：插件鉴权密钥（secret 型，write-only）。 */
  authSecret: SettingsFieldState
  /** 当前是否已配置非空 authSecret（仅用于显示状态标签，不回显密钥）。 */
  authSecretConfigured: boolean
  logEnabled: SettingsFieldState
  /** `long` / `short`，host 经 `getMemoryMode()` 发布。 */
  memoryMode: 'long' | 'short'
  /** `BillionDependencyStatus`，host 经 `getDependencyStatus()` 发布。 */
  billionStatus: string
  /** `config.walkerAiSwitches` 的只读投影，按 userId 排序。 */
  switches: WalkerSwitchRow[]
}

/** 注册侧业务面：暂存表单动作 + 宿主级启停 + 面板快照 hook。 */
export interface LumegazeCardFace extends SettingsFormActions {
  /**
   * S-M1-2：宿主级启用/禁用整个插件。经浏览器半 remote client 调
   * `pluginManager.setPluginEnabled(PLUGIN_ENTRY_ID, enabled)`；返回是否被宿主接受。
   * 失败时返回 false，面板仍保留插件内 `enabled` 草稿作为运行期兜底，不抛错。
   */
  setPluginEnabled: (enabled: boolean) => Promise<boolean>
  hooks: {
    /** 由渲染器绑定为 `useLumegazeCard`。 */
    lumegazeCard: SnapshotStore<LumegazeCardState>
  }
}

/** 布尔字段：草稿只能是 `true` / `false`，空草稿视为非法。 */
function settingsBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (value === true ? 'true' : value === false ? 'false' : ''),
    parse: (text) => {
      if (text === 'true') return { kind: 'set', value: true }
      if (text === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

import { parseServerUrlDraft } from './server-url.js'

/**
 * URL 字段：空值清空（不发起服务端 HTTP 交互）；非空必须以 http(s):// 开头，
 * 否则 `parse` 返回 undefined 使草稿非法、阻止保存（不落盘）。
 */
function settingsUrlField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (typeof value === 'string' ? value : ''),
    parse: (text) => parseServerUrlDraft(text),
  }
}

/**
 * 鉴权密钥字段（M3）：与观灵域客户端 T7 的 token 输入框对应。
 *
 * 这是 write-only secret：草稿永远从空白开始（绝不回显已存密钥），保存时经
 * `mutate` 原子写 `authSecret` volatile 字段；插件 WS 鉴权在每次握手读取该
 * volatile 值，因此保存后即时生效。
 */
function settingsAuthSecretSpec(scope: SettingsFormScope<LumegazeSettings>): SettingsSecretSpec {
  return {
    field: 'authSecret',
    write: async (text) => {
      const revision = scope.getSnapshot().revision
      return scope.mutate([{ op: 'set', path: ['authSecret'], value: text }], revision)
    },
  }
}

export class LumegazeCardController {
  private readonly scope: SettingsFormScope<LumegazeSettings>
  private readonly form: SettingsFormModel<LumegazeSettings>
  private readonly store: SnapshotStore<LumegazeCardState>
  /** S-M1-2：浏览器半 remote.pluginManager；未注入时宿主级调用降级为 false。 */
  private readonly pluginManager: PluginManagerRemoteLike | undefined

  /**
   * @param scope - `ctx.configForms.get('lumegaze')` 返回的共享配置表单。
   * @param pluginManager - `ctx.remote.pluginManager`（可选；缺省时宿主级启停不可用）。
   */
  constructor(scope: SettingsFormScope<LumegazeSettings>, pluginManager?: PluginManagerRemoteLike) {
    this.scope = scope
    this.pluginManager = pluginManager
    this.form = new SettingsFormModel<LumegazeSettings>(
      scope,
      [
        settingsBooleanField('enabled'),
        settingsNumberField('wsPort'),
        settingsUrlField('serverUrl'),
        settingsTextField('personaPrompt'),
        settingsBooleanField('logEnabled'),
      ],
      [settingsAuthSecretSpec(scope)],
    )
    this.store = this.form.bind(() => this.projection())
  }

  /** 由暂存表单与 namespace 快照重建面板状态。 */
  private projection(): LumegazeCardState {
    const snapshot = this.scope.getSnapshot()
    const value = snapshot.value
    const switches = Object.entries(value?.walkerAiSwitches ?? {})
      .filter(([userId, enabled]) => userId.length > 0 && typeof enabled === 'boolean')
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([userId, enabled]) => ({ userId, enabled: enabled as boolean }))
    return {
      ...this.form.shell(),
      status: snapshot.status,
      enabled: this.form.field('enabled'),
      wsPort: this.form.field('wsPort'),
      serverUrl: this.form.field('serverUrl'),
      personaPrompt: this.form.field('personaPrompt'),
      authSecret: this.form.field('authSecret'),
      authSecretConfigured: typeof value?.authSecret === 'string' && value.authSecret.length > 0,
      logEnabled: this.form.field('logEnabled'),
      memoryMode: value?.memoryMode === 'long' ? 'long' : 'short',
      billionStatus: typeof value?.billionStatus === 'string' ? value.billionStatus : 'unknown',
      switches,
    }
  }

  /** 构建注册进 `plugins.item` 的业务面。 */
  inject(): LumegazeCardFace {
    return {
      hooks: { lumegazeCard: this.store },
      setPluginEnabled: (enabled: boolean) => this.hostSetPluginEnabled(enabled),
      ...this.form.actions(),
    }
  }

  /**
   * S-M1-2：宿主级启停。经 remote client 调 `pluginManager.setPluginEnabled`。
   *
   * 成功语义收紧为解包 `RemoteResult<ChangeResult>.value.application`：仅
   * `'applied'` 返回 true；`'restart-required'` / `'overridden'` / `'cancelled'` /
   * `'failed'` 与非对象 / 缺 `ok: true` 的异常契约一律记 `console.warn` 并返回
   * false，插件内 `enabled` 草稿（运行期 WS 网关兜底）不受影响，面板不崩溃。
   */
  private async hostSetPluginEnabled(enabled: boolean): Promise<boolean> {
    const manager = this.pluginManager
    if (!manager || typeof manager.setPluginEnabled !== 'function') {
      console.warn('[dsh-lumegaze] remote.pluginManager unavailable; host toggle skipped (in-plugin switch fallback)')
      return false
    }
    try {
      const result = await manager.setPluginEnabled(PLUGIN_ENTRY_ID, enabled)
      // RemoteResult<ChangeResult> = { ok: true, value } | { ok: false, error }
      if (result === null || typeof result !== 'object') {
        console.warn('[dsh-lumegaze] setPluginEnabled returned non-object result:', result)
        return false
      }
      const typed = result as {
        ok?: boolean
        error?: unknown
        value?: { application?: string }
      }
      if (typed.ok === false) {
        console.warn('[dsh-lumegaze] setPluginEnabled refused:', typed.error)
        return false
      }
      // S-M1-2：只有 `application === 'applied'` 才代表宿主即时生效；
      // restart-required / overridden / cancelled / failed 均为非 applied，视为失败
      // （插件内 `enabled` 草稿仍作为运行期兜底，面板不崩溃）。
      if (typed.ok !== true) {
        console.warn('[dsh-lumegaze] setPluginEnabled result missing ok=true:', typed)
        return false
      }
      if (typed.value?.application !== 'applied') {
        console.warn(
          '[dsh-lumegaze] setPluginEnabled not applied: application=%s (in-plugin switch fallback only)',
          typed.value?.application ?? 'undefined',
        )
        return false
      }
      return true
    } catch (error) {
      console.warn('[dsh-lumegaze] setPluginEnabled failed:', error)
      return false
    }
  }

  /** 释放表单订阅。 */
  dispose(): void {
    this.form.dispose()
  }
}

/** `ctx.configForms.get('lumegaze')` 的窄化辅助（保持与官方面板一致的类型面）。 */
export type LumegazeConfigForm = ConfigForm<LumegazeSettings>

/**
 * S-M1-2：Loader entry id（见 `dsh.bundle.patch.yml`：`- id: lumagaze, name: dsh-lumegaze`）。
 * 该 id 同时是本插件的 settings namespace；宿主级 `setPluginEnabled` 以它为键。
 */
export const PLUGIN_ENTRY_ID = 'lumegaze'

/**
 * `ctx.remote.pluginManager` 的最小调用面（浏览器半 TypertRemoteService）。
 *
 * 只声明面板用到的 `setPluginEnabled`，避免为远程类型包引入额外编译期依赖；
 * 远程返回 `RemoteResult<ChangeResult>`，由调用方按 `{ ok, value|error }` 解包。
 */
export interface PluginManagerRemoteLike {
  setPluginEnabled(id: string, enabled: boolean): Promise<unknown>
}
