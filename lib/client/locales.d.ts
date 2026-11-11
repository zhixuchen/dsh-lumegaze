/**
 * Lumegaze 配置面板文案（字典 namespace = `settings.lumegaze`）。
 *
 * 与官方 shell 面板一致：zh 为键集事实来源，en 逐键补齐（缺键 / 多键均为编译错误）。
 */
import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives';
/** 本插件拥有的字典 namespace。 */
export declare const NS = "settings.lumegaze";
/** 面板文案键。 */
export type LumegazeLocaleKey = 'title' | 'description' | 'pluginToggle' | 'pluginToggleHint' | 'pluginToggleDisableConfirm' | 'confirmDisable' | 'cancel' | 'authSecret' | 'authSecretHint' | 'authSecretConfigured' | 'wsPort' | 'wsPortHint' | 'serverUrl' | 'serverUrlHint' | 'serverUrlInvalid' | 'personaPrompt' | 'personaPromptHint' | 'memoryMode' | 'memoryModeLong' | 'memoryModeShort' | 'dependency' | 'dependencyInstalled' | 'dependencyMissing' | 'dependencyUnknown' | 'switches' | 'switchesEmpty' | 'switchEnabled' | 'switchDisabled' | 'logEnabled' | 'logEnabledHint' | 'overridden' | 'reset' | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed' | 'invalidNumber' | 'loading' | 'loadFailed' | 'retry';
/** 简体中文文案。 */
export declare const zh: Record<LumegazeLocaleKey, string>;
/** English copy, checked complete against the zh key set. */
export declare const en: Record<LumegazeLocaleKey, string>;
/** 表单框架文案（来自本页字典）。 */
export declare function formLabels(t: (key: LumegazeLocaleKey) => string): SettingsFormLabels;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Lumegaze 配置面板文案。 */
        'settings.lumegaze': LumegazeLocaleKey;
    }
}
//# sourceMappingURL=locales.d.ts.map