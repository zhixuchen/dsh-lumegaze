import { SettingsFormModel, settingsNumberField, settingsTextField, } from '@deepseek-ai/dsh-client-ui-primitives';
/** 布尔字段：草稿只能是 `true` / `false`，空草稿视为非法。 */
function settingsBooleanField(field) {
    return {
        field,
        format: (value) => (value === true ? 'true' : value === false ? 'false' : ''),
        parse: (text) => {
            if (text === 'true')
                return { kind: 'set', value: true };
            if (text === 'false')
                return { kind: 'set', value: false };
            return undefined;
        },
    };
}
import { parseServerUrlDraft } from './server-url.js';
/**
 * URL 字段：空值清空（不发起服务端 HTTP 交互）；非空必须以 http(s):// 开头，
 * 否则 `parse` 返回 undefined 使草稿非法、阻止保存（不落盘）。
 */
function settingsUrlField(field) {
    return {
        field,
        format: (value) => (typeof value === 'string' ? value : ''),
        parse: (text) => parseServerUrlDraft(text),
    };
}
/**
 * 鉴权密钥字段（M3）：与观灵域客户端 T7 的 token 输入框对应。
 *
 * 这是 write-only secret：草稿永远从空白开始（绝不回显已存密钥），保存时经
 * `mutate` 原子写 `authSecret` volatile 字段；插件 WS 鉴权在每次握手读取该
 * volatile 值，因此保存后即时生效。
 */
function settingsAuthSecretSpec(scope) {
    return {
        field: 'authSecret',
        write: async (text) => {
            const revision = scope.getSnapshot().revision;
            return scope.mutate([{ op: 'set', path: ['authSecret'], value: text }], revision);
        },
    };
}
export class LumegazeCardController {
    scope;
    form;
    store;
    /** S-M1-2：浏览器半 remote.pluginManager；未注入时宿主级调用降级为 false。 */
    pluginManager;
    /**
     * @param scope - `ctx.configForms.get('lumegaze')` 返回的共享配置表单。
     * @param pluginManager - `ctx.remote.pluginManager`（可选；缺省时宿主级启停不可用）。
     */
    constructor(scope, pluginManager) {
        this.scope = scope;
        this.pluginManager = pluginManager;
        this.form = new SettingsFormModel(scope, [
            settingsBooleanField('enabled'),
            settingsNumberField('wsPort'),
            settingsUrlField('serverUrl'),
            settingsTextField('personaPrompt'),
            settingsBooleanField('logEnabled'),
        ], [settingsAuthSecretSpec(scope)]);
        this.store = this.form.bind(() => this.projection());
    }
    /** 由暂存表单与 namespace 快照重建面板状态。 */
    projection() {
        const snapshot = this.scope.getSnapshot();
        const value = snapshot.value;
        const switches = Object.entries(value?.walkerAiSwitches ?? {})
            .filter(([userId, enabled]) => userId.length > 0 && typeof enabled === 'boolean')
            .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .map(([userId, enabled]) => ({ userId, enabled: enabled }));
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
        };
    }
    /** 构建注册进 `plugins.item` 的业务面。 */
    inject() {
        return {
            hooks: { lumegazeCard: this.store },
            setPluginEnabled: (enabled) => this.hostSetPluginEnabled(enabled),
            ...this.form.actions(),
        };
    }
    /**
     * S-M1-2：宿主级启停。经 remote client 调 `pluginManager.setPluginEnabled`。
     *
     * 成功语义收紧为解包 `RemoteResult<ChangeResult>.value.application`：仅
     * `'applied'` 返回 true；`'restart-required'` / `'overridden'` / `'cancelled'` /
     * `'failed'` 与非对象 / 缺 `ok: true` 的异常契约一律记 `console.warn` 并返回
     * false，插件内 `enabled` 草稿（运行期 WS 网关兜底）不受影响，面板不崩溃。
     */
    async hostSetPluginEnabled(enabled) {
        const manager = this.pluginManager;
        if (!manager || typeof manager.setPluginEnabled !== 'function') {
            console.warn('[dsh-lumegaze] remote.pluginManager unavailable; host toggle skipped (in-plugin switch fallback)');
            return false;
        }
        try {
            const result = await manager.setPluginEnabled(PLUGIN_ENTRY_ID, enabled);
            // RemoteResult<ChangeResult> = { ok: true, value } | { ok: false, error }
            if (result === null || typeof result !== 'object') {
                console.warn('[dsh-lumegaze] setPluginEnabled returned non-object result:', result);
                return false;
            }
            const typed = result;
            if (typed.ok === false) {
                console.warn('[dsh-lumegaze] setPluginEnabled refused:', typed.error);
                return false;
            }
            // S-M1-2：只有 `application === 'applied'` 才代表宿主即时生效；
            // restart-required / overridden / cancelled / failed 均为非 applied，视为失败
            // （插件内 `enabled` 草稿仍作为运行期兜底，面板不崩溃）。
            if (typed.ok !== true) {
                console.warn('[dsh-lumegaze] setPluginEnabled result missing ok=true:', typed);
                return false;
            }
            if (typed.value?.application !== 'applied') {
                console.warn('[dsh-lumegaze] setPluginEnabled not applied: application=%s (in-plugin switch fallback only)', typed.value?.application ?? 'undefined');
                return false;
            }
            return true;
        }
        catch (error) {
            console.warn('[dsh-lumegaze] setPluginEnabled failed:', error);
            return false;
        }
    }
    /** 释放表单订阅。 */
    dispose() {
        this.form.dispose();
    }
}
/**
 * S-M1-2：Loader entry id（见 `dsh.bundle.patch.yml`：`- id: lumagaze, name: dsh-lumegaze`）。
 * 该 id 同时是本插件的 settings namespace；宿主级 `setPluginEnabled` 以它为键。
 */
export const PLUGIN_ENTRY_ID = 'lumegaze';
//# sourceMappingURL=lumegaze-card-controller.js.map