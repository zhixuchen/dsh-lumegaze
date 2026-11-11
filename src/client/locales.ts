/**
 * Lumegaze 配置面板文案（字典 namespace = `settings.lumegaze`）。
 *
 * 与官方 shell 面板一致：zh 为键集事实来源，en 逐键补齐（缺键 / 多键均为编译错误）。
 */
import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** 本插件拥有的字典 namespace。 */
export const NS = 'settings.lumegaze'

/** 面板文案键。 */
export type LumegazeLocaleKey =
  | 'title'
  | 'description'
  | 'pluginToggle'
  | 'pluginToggleHint'
  | 'pluginToggleDisableConfirm'
  | 'confirmDisable'
  | 'cancel'
  | 'authSecret'
  | 'authSecretHint'
  | 'authSecretConfigured'
  | 'wsPort'
  | 'wsPortHint'
  | 'serverUrl'
  | 'serverUrlHint'
  | 'serverUrlInvalid'
  | 'personaPrompt'
  | 'personaPromptHint'
  | 'memoryMode'
  | 'memoryModeLong'
  | 'memoryModeShort'
  | 'dependency'
  | 'dependencyInstalled'
  | 'dependencyMissing'
  | 'dependencyUnknown'
  | 'switches'
  | 'switchesEmpty'
  | 'switchEnabled'
  | 'switchDisabled'
  | 'logEnabled'
  | 'logEnabledHint'
  | 'overridden'
  | 'reset'
  | 'readOnly'
  | 'unavailable'
  | 'save'
  | 'saving'
  | 'saveFailed'
  | 'invalidNumber'
  | 'loading'
  | 'loadFailed'
  | 'retry'

/** 简体中文文案。 */
export const zh: Record<LumegazeLocaleKey, string> = {
  title: '观灵域行者',
  description: '观灵域行者 AI 网关：WebSocket 端口、服务端地址与行者人设。',
  pluginToggle: '插件总开关',
  pluginToggleHint: '启用或禁用整个插件：关闭会经宿主插件管理器停用本插件（面板随之消失，可从 DSH 插件管理器重新启用）；插件内 enabled 继续作为运行期 WS 网关兜底。',
  pluginToggleDisableConfirm: '确认禁用？宿主级禁用会卸载本插件，面板将消失，需从 DSH 插件管理器重新启用。',
  confirmDisable: '确认禁用',
  cancel: '取消',
  authSecret: '插件鉴权密钥',
  authSecretHint: '与观灵域客户端 token 输入框对应；留空表示 WS 握手不鉴权。保存后插件鉴权即时生效。',
  authSecretConfigured: '已配置',
  wsPort: 'WebSocket 监听端口',
  wsPortHint: '仅绑定 127.0.0.1；留空使用默认 8790。',
  serverUrl: '游戏服务端 URL',
  serverUrlHint: '以 http(s):// 开头；留空表示不发起服务端 HTTP 交互。',
  serverUrlInvalid: '需以 http:// 或 https:// 开头。',
  personaPrompt: '行者通用人设 Prompt',
  personaPromptHint: '多行编辑；留空表示不追加额外人设。',
  memoryMode: '记忆模式',
  memoryModeLong: '已接入长期记忆',
  memoryModeShort: '短期记忆降级模式',
  dependency: '依赖状态',
  dependencyInstalled: 'billion-context 已安装',
  dependencyMissing: '未安装（自动安装失败）',
  dependencyUnknown: '状态未知',
  switches: '用户开关状态',
  switchesEmpty: '暂无用户开关记录。',
  switchEnabled: '已开启',
  switchDisabled: '已关闭',
  logEnabled: '详细运行日志',
  logEnabledHint: '开启后输出更详细的运行日志。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '保存未被接受，请修正后重试。',
  invalidNumber: '请填 1–65535 的整数。',
  loading: '加载中…',
  loadFailed: '配置加载失败，请重试。',
  retry: '重试',
}

/** English copy, checked complete against the zh key set. */
export const en: Record<LumegazeLocaleKey, string> = {
  title: 'Guanlingyu Walker',
  description: 'Guanlingyu walker AI gateway: WebSocket port, server URL and walker persona.',
  pluginToggle: 'Plugin master switch',
  pluginToggleHint: 'Enable or disable the whole plugin: turning it off calls the host plugin manager to unload this plugin (the panel disappears; re-enable it from the DSH plugin manager). The in-plugin enabled flag remains the runtime WS gateway fallback.',
  pluginToggleDisableConfirm: 'Disable? Host-level disabling unloads this plugin and the panel disappears; re-enable it from the DSH plugin manager.',
  confirmDisable: 'Disable',
  cancel: 'Cancel',
  authSecret: 'Plugin auth secret',
  authSecretHint: 'Matches the token field in the Guanlingyu client; leave blank to disable WS handshake auth. Takes effect immediately after saving.',
  authSecretConfigured: 'Configured',
  wsPort: 'WebSocket listen port',
  wsPortHint: 'Bound to 127.0.0.1 only; leave blank for the default 8790.',
  serverUrl: 'Game server URL',
  serverUrlHint: 'Starts with http(s)://; blank means no server HTTP interaction.',
  serverUrlInvalid: 'Must start with http:// or https://.',
  personaPrompt: 'Walker persona prompt',
  personaPromptHint: 'Multi-line; blank means no extra persona is appended.',
  memoryMode: 'Memory mode',
  memoryModeLong: 'Long-term memory connected',
  memoryModeShort: 'Short-term memory fallback mode',
  dependency: 'Dependency status',
  dependencyInstalled: 'billion-context installed',
  dependencyMissing: 'Not installed (automatic install failed)',
  dependencyUnknown: 'Status unknown',
  switches: 'Per-user switches',
  switchesEmpty: 'No per-user switch records yet.',
  switchEnabled: 'Enabled',
  switchDisabled: 'Disabled',
  logEnabled: 'Detailed runtime logs',
  logEnabledHint: 'Emit more detailed runtime logs when enabled.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; correct them and retry.',
  invalidNumber: 'Enter an integer between 1 and 65535.',
  loading: 'Loading…',
  loadFailed: 'Failed to load the configuration; please retry.',
  retry: 'Retry',
}

/** 表单框架文案（来自本页字典）。 */
export function formLabels(t: (key: LumegazeLocaleKey) => string): SettingsFormLabels {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Lumegaze 配置面板文案。 */
    'settings.lumegaze': LumegazeLocaleKey
  }
}
