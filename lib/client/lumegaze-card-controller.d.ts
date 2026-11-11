/**
 * Lumegaze 配置面板的暂存表单控制器。
 *
 * 与官方 shell 面板一致：`SettingsFormModel` 把用户输入暂存为草稿，只有「保存」
 * 才经 `configForms` 做一次带 revision 的原子写。运行期状态（记忆模式 / 依赖状态 /
 * 用户开关表）不参与暂存，直接从同一 namespace 的快照读取，因此 toggle 变化会
 * 实时反映到面板。
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import { type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives';
/** 本插件 settings namespace `lumegaze` 的可编辑 / 只读字段。 */
export interface LumegazeSettings {
    enabled?: boolean;
    wsPort?: number;
    serverUrl?: string;
    personaPrompt?: string;
    /** M3：插件 WS 握手鉴权密钥（与客户端 token 输入框对应）。 */
    authSecret?: string;
    logEnabled?: boolean;
    walkerAiSwitches?: Record<string, boolean>;
    memoryMode?: string;
    billionStatus?: string;
}
/** 用户开关只读列表的一行。 */
export interface WalkerSwitchRow {
    userId: string;
    enabled: boolean;
}
/** 面板渲染所需的全部状态。 */
export interface LumegazeCardState extends SettingsFormShell {
    /** namespace 同步状态：加载中 / 就绪 / 不可用。 */
    status: 'loading' | 'ready' | 'unavailable';
    enabled: SettingsFieldState;
    wsPort: SettingsFieldState;
    serverUrl: SettingsFieldState;
    personaPrompt: SettingsFieldState;
    /** M3：插件鉴权密钥（secret 型，write-only）。 */
    authSecret: SettingsFieldState;
    /** 当前是否已配置非空 authSecret（仅用于显示状态标签，不回显密钥）。 */
    authSecretConfigured: boolean;
    logEnabled: SettingsFieldState;
    /** `long` / `short`，host 经 `getMemoryMode()` 发布。 */
    memoryMode: 'long' | 'short';
    /** `BillionDependencyStatus`，host 经 `getDependencyStatus()` 发布。 */
    billionStatus: string;
    /** `config.walkerAiSwitches` 的只读投影，按 userId 排序。 */
    switches: WalkerSwitchRow[];
}
/** 注册侧业务面：暂存表单动作 + 宿主级启停 + 面板快照 hook。 */
export interface LumegazeCardFace extends SettingsFormActions {
    /**
     * S-M1-2：宿主级启用/禁用整个插件。经浏览器半 remote client 调
     * `pluginManager.setPluginEnabled(PLUGIN_ENTRY_ID, enabled)`；返回是否被宿主接受。
     * 失败时返回 false，面板仍保留插件内 `enabled` 草稿作为运行期兜底，不抛错。
     */
    setPluginEnabled: (enabled: boolean) => Promise<boolean>;
    hooks: {
        /** 由渲染器绑定为 `useLumegazeCard`。 */
        lumegazeCard: SnapshotStore<LumegazeCardState>;
    };
}
export declare class LumegazeCardController {
    private readonly scope;
    private readonly form;
    private readonly store;
    /** S-M1-2：浏览器半 remote.pluginManager；未注入时宿主级调用降级为 false。 */
    private readonly pluginManager;
    /**
     * @param scope - `ctx.configForms.get('lumegaze')` 返回的共享配置表单。
     * @param pluginManager - `ctx.remote.pluginManager`（可选；缺省时宿主级启停不可用）。
     */
    constructor(scope: SettingsFormScope<LumegazeSettings>, pluginManager?: PluginManagerRemoteLike);
    /** 由暂存表单与 namespace 快照重建面板状态。 */
    private projection;
    /** 构建注册进 `plugins.item` 的业务面。 */
    inject(): LumegazeCardFace;
    /**
     * S-M1-2：宿主级启停。经 remote client 调 `pluginManager.setPluginEnabled`。
     *
     * 成功语义收紧为解包 `RemoteResult<ChangeResult>.value.application`：仅
     * `'applied'` 返回 true；`'restart-required'` / `'overridden'` / `'cancelled'` /
     * `'failed'` 与非对象 / 缺 `ok: true` 的异常契约一律记 `console.warn` 并返回
     * false，插件内 `enabled` 草稿（运行期 WS 网关兜底）不受影响，面板不崩溃。
     */
    private hostSetPluginEnabled;
    /** 释放表单订阅。 */
    dispose(): void;
}
/** `ctx.configForms.get('lumegaze')` 的窄化辅助（保持与官方面板一致的类型面）。 */
export type LumegazeConfigForm = ConfigForm<LumegazeSettings>;
/**
 * S-M1-2：Loader entry id（见 `dsh.bundle.patch.yml`：`- id: lumagaze, name: dsh-lumegaze`）。
 * 该 id 同时是本插件的 settings namespace；宿主级 `setPluginEnabled` 以它为键。
 */
export declare const PLUGIN_ENTRY_ID = "lumegaze";
/**
 * `ctx.remote.pluginManager` 的最小调用面（浏览器半 TypertRemoteService）。
 *
 * 只声明面板用到的 `setPluginEnabled`，避免为远程类型包引入额外编译期依赖；
 * 远程返回 `RemoteResult<ChangeResult>`，由调用方按 `{ ok, value|error }` 解包。
 */
export interface PluginManagerRemoteLike {
    setPluginEnabled(id: string, enabled: boolean): Promise<unknown>;
}
//# sourceMappingURL=lumegaze-card-controller.d.ts.map