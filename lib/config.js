import z from '@deepseek-ai/schemastery';
/**
 * dsh-lumegaze 插件 Config Schema（schemastery）。
 *
 * 所有字段均为 `volatile`：DSH 的 SettingsForms 只把最近 volatile 祖先的字段
 * 暴露为可在线编辑项，`ctx.settings.update()` 也只接受 volatile 路径。运行时
 * 解析后的 volatile 字段会被 cordis 包成 `Volatile<T>`（见 schemastery
 * `Schema.resolve`），因此 `apply()` 读到的是带 `.get()` 的引用。
 */
// 显式类型标注：schemastery 的推断类型会引用 cosmokit 的 `Dict`，在 pnpm 隔离
// node_modules 下生成不可移植的 `.pnpm/...` 路径（TS2742）。用 schemastery 公共
// 类型标注后，.d.ts 只引用 `Schemastery`，不再泄漏 cosmokit 路径。
/**
 * profile Loader 行 id（见 dsh.bundle.patch.yml），同时是 `ctx.settings` 的
 * namespace：`ctx.settings.describe()` / `update()` / `mutate()` 都以它为键。
 */
export const SETTINGS_NAMESPACE = 'lumegaze';
export const Config = z.object({
    /**
     * 插件总开关（M1，配置面板绑定）：运行期功能开关。为 false 时 apply() 不启动
     * WS 网关，且已运行的网关会在每帧拦截 chat / game_tick 并回 PLUGIN_DISABLED。
     * 注意：这是插件内功能开关，不是 DSH 插件管理级启用/禁用（SDK 无
     * install/enable/disable 钩子；管理级启停须由宿主 `setPluginEnabled` 负责）。
     */
    enabled: z.boolean().volatile().default(true),
    /** 本地 WebSocket 监听端口，仅绑定 127.0.0.1。默认 8790（游戏服务端用 8787）。 */
    wsPort: z.number().volatile().min(1).max(65535).default(8790),
    /** 游戏服务端 URL；空值表示不发起任何服务端 HTTP 交互。 */
    serverUrl: z.string().volatile().default(''),
    /** 行者通用人设 Prompt。 */
    personaPrompt: z.string().volatile().default(''),
    /** 插件 WS 握手鉴权密钥；空值表示不鉴权。 */
    authSecret: z.string().volatile().default(''),
    /** 是否输出详细运行日志。 */
    logEnabled: z.boolean().volatile().default(false),
    /**
     * 运行态：userId → walkerAiEnable。
     * 经 volatile 字段持久化到 profile patch，重启后保留；DSH 未提供插件私有 KV。
     */
    walkerAiSwitches: z.dict(z.boolean()).volatile().default({}),
    /**
     * 运行期记忆模式（host 发布，面板只读展示）。值域 `long` / `short`，
     * 由 `getMemoryMode()` 写入；浏览器半无法直接 import host 函数，故经 configForms 读取。
     */
    memoryMode: z.string().volatile().default('short'),
    /**
     * 运行期 billion-context 依赖状态（host 发布，面板只读展示）。
     * 值域 `BillionDependencyStatus`，由 `getDependencyStatus()` 写入。
     */
    billionStatus: z.string().volatile().default('unknown'),
});
/** 读取 volatile 字段：运行时是 `Volatile<T>`，测试/裸调用可能直接是 `T`。 */
export function readVolatile(value) {
    if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
        return value.get();
    }
    return value;
}
//# sourceMappingURL=config.js.map