import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'

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
export const SETTINGS_NAMESPACE = 'lumegaze'

export const Config: Schemastery<any, any, 'plain'> = z.object({
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
})

/** `apply(ctx, config)` 收到的运行时配置形状（volatile 字段已包成 `Volatile<T>`）。 */
export interface Config {
  wsPort: Volatile<number>
  serverUrl: Volatile<string>
  personaPrompt: Volatile<string>
  authSecret: Volatile<string>
  logEnabled: Volatile<boolean>
  walkerAiSwitches: Volatile<Record<string, boolean>>
}

/** 读取 volatile 字段：运行时是 `Volatile<T>`，测试/裸调用可能直接是 `T`。 */
export function readVolatile<T>(value: T | Volatile<T>): T {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    return (value as { get(): T }).get()
  }
  return value as T
}
