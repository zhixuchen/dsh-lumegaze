import type { Volatile } from '@deepseek-ai/cordis';
/**
 * dsh-lumegaze 插件 Config Schema（schemastery）。
 *
 * 所有字段均为 `volatile`：DSH 的 SettingsForms 只把最近 volatile 祖先的字段
 * 暴露为可在线编辑项，`ctx.settings.update()` 也只接受 volatile 路径。运行时
 * 解析后的 volatile 字段会被 cordis 包成 `Volatile<T>`（见 schemastery
 * `Schema.resolve`），因此 `apply()` 读到的是带 `.get()` 的引用。
 */
/**
 * profile Loader 行 id（见 dsh.bundle.patch.yml），同时是 `ctx.settings` 的
 * namespace：`ctx.settings.describe()` / `update()` / `mutate()` 都以它为键。
 */
export declare const SETTINGS_NAMESPACE = "lumegaze";
export declare const Config: Schemastery<any, any, 'plain'>;
/** `apply(ctx, config)` 收到的运行时配置形状（volatile 字段已包成 `Volatile<T>`）。 */
export interface Config {
    enabled: Volatile<boolean>;
    wsPort: Volatile<number>;
    serverUrl: Volatile<string>;
    personaPrompt: Volatile<string>;
    authSecret: Volatile<string>;
    logEnabled: Volatile<boolean>;
    walkerAiSwitches: Volatile<Record<string, boolean>>;
    memoryMode: Volatile<string>;
    billionStatus: Volatile<string>;
}
/** 读取 volatile 字段：运行时是 `Volatile<T>`，测试/裸调用可能直接是 `T`。 */
export declare function readVolatile<T>(value: T | Volatile<T>): T;
//# sourceMappingURL=config.d.ts.map