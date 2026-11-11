/**
 * Lumegaze 配置面板（DSH 插件内置设置页）。
 *
 * 覆盖规格第五章全部 7 项（插件总开关、WebSocket 端口、游戏服务端 URL（含格式校验）、
 * 行者通用人设 Prompt（多行）、状态展示区（记忆模式 / 依赖状态）、用户开关只读列表、
 * 日志开关），并追加 M3 插件鉴权密钥（write-only secret，对应客户端 token 输入框）。
 * 运行态数据经 `ctx.configForms.get('lumegaze')` 读取，随 toggle 实时更新。
 */
import { useState, type ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {
  SettingsForm,
  SettingsSecretField,
  SettingsValueField,
  Switch,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { formLabels, type LumegazeLocaleKey } from './locales.js'
import type { LumegazeCardFace, LumegazeCardState } from './lumegaze-card-controller.js'

/** 面板组件 props：`plugins.item` 运行契约 + 本页字典 + 注册侧业务面。 */
export type LumegazeCardProps =
  & PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.lumegaze'>
  & InjectFace<LumegazeCardFace>

/** `plugins.item` owner 契约（导入同时把该 slot 声明并入编译面）。 */
export type LumegazeItemOwner = PluginConfigViewProps

const STYLE_ID = 'dsh-lumegaze/LumegazeCard.module.css'

const CSS = `
.lumegaze-section{display:flex;flex-direction:column;gap:16px}
.lumegaze-row{display:flex;flex-direction:column;gap:6px}
.lumegaze-row-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.lumegaze-label{font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}
.lumegaze-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.lumegaze-state{margin:0;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.lumegaze-textarea{width:100%;min-height:96px;padding:8px 10px;font:inherit;font-size:13px;line-height:1.5;resize:vertical;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-surface-primary,transparent);color:var(--dsw-alias-label-primary)}
.lumegaze-textarea:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.lumegaze-status{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.lumegaze-status-cell{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px}
.lumegaze-status-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.lumegaze-status-value{font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}
.lumegaze-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.lumegaze-list-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.lumegaze-list-empty{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.lumegaze-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}
.lumegaze-confirm{margin-left:8px;padding:2px 10px;font:inherit;font-size:12px;line-height:18px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-surface-primary,transparent);color:var(--dsw-alias-label-primary);cursor:pointer}
.lumegaze-confirm:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
`

/** 注入面板样式（幂等；与官方 settings 卡片同款 document.head 注入）。 */
function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-lumegaze'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

ensureStyles()

/** 依赖状态 → 标签色调（状态不只靠颜色：同时有文字）。 */
function dependencyTone(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'installed') return 'success'
  if (status === 'missing' || status === 'failed' || status === 'cancelled' || status === 'overridden') {
    return 'danger'
  }
  if (status === 'installing' || status === 'restart-required') return 'warning'
  return 'neutral'
}

/** 依赖状态 → 文案。 */
function dependencyLabel(
  t: (key: LumegazeLocaleKey) => string,
  status: string,
): string {
  if (status === 'installed') return t('dependencyInstalled')
  if (
    status === 'missing' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'overridden'
  ) {
    return t('dependencyMissing')
  }
  return t('dependencyUnknown')
}

/**
 * 渲染 Lumegaze 面板：一行摘要，或（view === 'page'）完整配置表单。
 * @param props - 渲染器绑定的 view、本页字典与注册侧业务面。
 */
export function LumegazeCard(props: LumegazeCardProps): string | ReactElement {
  const { t } = props
  const state: LumegazeCardState = props.useLumegazeCard((snapshot) => snapshot)
  // S-M1-2：宿主级禁用会卸载本插件，关闭方向先确认再调用 setPluginEnabled。
  const [confirmingDisable, setConfirmingDisable] = useState(false)

  // Plugins 页列表行的一行摘要。
  if (props.view === 'summary') return t('description')

  // 空 / 加载 / 错误三态。
  if (state.status === 'loading') return <p className="lumegaze-state">{t('loading')}</p>
  if (state.status === 'unavailable' || !state.available) {
    return <p className="lumegaze-state">{t('unavailable')}</p>
  }

  const disabled = !state.writable || state.saving

  return (
    <SettingsForm
      labels={formLabels(t)}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <section className="lumegaze-section">
        {/* 1. 插件总开关（S-M1-2：宿主级启停 + 插件内 WS 开关兜底） */}
        <div className="lumegaze-row">
          <div className="lumegaze-row-head">
            <span className="lumegaze-label">{t('pluginToggle')}</span>
            <Switch
              checked={state.enabled.text === 'true'}
              onChange={(next) => {
                if (next) {
                  setConfirmingDisable(false)
                  props.edit('enabled', 'true')
                  void props.setPluginEnabled(true)
                } else {
                  setConfirmingDisable(true)
                }
              }}
              label={t('pluginToggle')}
              disabled={disabled || state.enabled.invalid}
              title={disabled ? t('readOnly') : undefined}
            />
          </div>
          <p className="lumegaze-hint">{t('pluginToggleHint')}</p>
          {confirmingDisable ? (
            <p className="lumegaze-hint">
              {t('pluginToggleDisableConfirm')}
              <button
                type="button"
                className="lumegaze-confirm"
                onClick={() => {
                  setConfirmingDisable(false)
                  props.edit('enabled', 'false')
                  void props.setPluginEnabled(false)
                }}
              >
                {t('confirmDisable')}
              </button>
              <button type="button" className="lumegaze-confirm" onClick={() => setConfirmingDisable(false)}>
                {t('cancel')}
              </button>
            </p>
          ) : null}
        </div>

        {/* M3. 插件鉴权密钥（write-only secret，对应观灵域客户端 token 输入框） */}
        <SettingsSecretField
          id="plugin-config-lumegaze-auth-secret"
          label={t('authSecret')}
          hint={t('authSecretHint')}
          text={state.authSecret.text}
          disabled={disabled}
          onEdit={(text) => props.edit('authSecret', text)}
          configured={state.authSecretConfigured}
          stateLabel={t('authSecretConfigured')}
        />

        {/* 2. WebSocket 监听端口 */}
        <SettingsValueField
          id="plugin-config-lumegaze-ws-port"
          label={t('wsPort')}
          hint={state.wsPort.invalid ? t('invalidNumber') : t('wsPortHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          numeric
          placeholder="8790"
          disabled={disabled}
          {...state.wsPort}
          onEdit={(text) => props.edit('wsPort', text)}
          onReset={() => props.resetField('wsPort')}
        />

        {/* 3. 游戏服务端 URL（http(s):// 校验，非法不落盘） */}
        <SettingsValueField
          id="plugin-config-lumegaze-server-url"
          label={t('serverUrl')}
          hint={state.serverUrl.invalid ? t('serverUrlInvalid') : t('serverUrlHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('serverUrlInvalid')}
          disabled={disabled}
          {...state.serverUrl}
          onEdit={(text) => props.edit('serverUrl', text)}
          onReset={() => props.resetField('serverUrl')}
        />

        {/* 4. 行者通用人设 Prompt（多行，超长不破版） */}
        <div className="lumegaze-row">
          <label className="lumegaze-label" htmlFor="plugin-config-lumegaze-persona">
            {t('personaPrompt')}
          </label>
          <textarea
            id="plugin-config-lumegaze-persona"
            className="lumegaze-textarea"
            value={state.personaPrompt.text}
            placeholder={t('personaPromptHint')}
            disabled={disabled}
            aria-invalid={state.personaPrompt.invalid || undefined}
            onChange={(event) => props.edit('personaPrompt', event.target.value)}
          />
          <p className="lumegaze-hint">{t('personaPromptHint')}</p>
        </div>

        {/* 5. 状态展示区：记忆模式 + 依赖状态 */}
        <section className="lumegaze-status" aria-label={t('memoryMode')}>
          <div className="lumegaze-status-cell">
            <span className="lumegaze-status-label">{t('memoryMode')}</span>
            <span className="lumegaze-status-value">
              <Tag tone={state.memoryMode === 'long' ? 'success' : 'warning'}>
                {state.memoryMode === 'long' ? t('memoryModeLong') : t('memoryModeShort')}
              </Tag>
            </span>
          </div>
          <div className="lumegaze-status-cell">
            <span className="lumegaze-status-label">{t('dependency')}</span>
            <span className="lumegaze-status-value">
              <Tag tone={dependencyTone(state.billionStatus)}>
                {dependencyLabel(t, state.billionStatus)}
              </Tag>
            </span>
          </div>
        </section>

        {/* 6. 用户开关状态只读列表 */}
        <section className="lumegaze-row" aria-label={t('switches')}>
          <span className="lumegaze-label">{t('switches')}</span>
          {state.switches.length === 0 ? (
            <p className="lumegaze-list-empty">{t('switchesEmpty')}</p>
          ) : (
            <ul className="lumegaze-list">
              {state.switches.map((row) => (
                <li key={row.userId} className="lumegaze-list-row">
                  <span className="lumegaze-mono">{row.userId}</span>
                  <Tag tone={row.enabled ? 'success' : 'neutral'}>
                    {row.enabled ? t('switchEnabled') : t('switchDisabled')}
                  </Tag>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 7. 日志开关 */}
        <div className="lumegaze-row">
          <div className="lumegaze-row-head">
            <span className="lumegaze-label">{t('logEnabled')}</span>
            <Switch
              checked={state.logEnabled.text === 'true'}
              onChange={(next) => props.edit('logEnabled', next ? 'true' : 'false')}
              label={t('logEnabled')}
              disabled={disabled || state.logEnabled.invalid}
              title={disabled ? t('readOnly') : undefined}
            />
          </div>
          <p className="lumegaze-hint">{t('logEnabledHint')}</p>
        </div>
      </section>
    </SettingsForm>
  )
}
