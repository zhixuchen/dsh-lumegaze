/**
 * userId 维度的行者 AI 总开关运行态（规格第二章 4 / 第六章 2-4）。
 *
 * - 内存态 Map 保证「userId 开关互不影响」。
 * - `persistFn` 由 index 注入：通过 `ctx.settings.mutate` 把整张开关表写回
 *   volatile 字段 `walkerAiSwitches`（profile patch 持久化，DSH 重启保留）。
 * - 持久化失败只记日志、返回 false，不改变内存态，绝不阻断 WS 回包。
 */

export type SwitchPersistFn = (snapshot: Record<string, boolean>) => Promise<boolean>

export class WalkerSwitches {
  private readonly enabled = new Map<string, boolean>()
  private persistFn: SwitchPersistFn | undefined

  constructor(initial: Readonly<Record<string, boolean>> = {}) {
    for (const [userId, value] of Object.entries(initial)) {
      if (typeof value === 'boolean' && userId.length > 0) {
        this.enabled.set(userId, value)
      }
    }
  }

  /** 注入持久化回调（在 apply 内设置）。 */
  setPersist(fn?: SwitchPersistFn): void {
    this.persistFn = fn
  }

  isEnabled(userId: string): boolean {
    return this.enabled.get(userId) === true
  }

  set(userId: string, value: boolean): void {
    if (userId.length > 0) this.enabled.set(userId, value)
  }

  snapshot(): Record<string, boolean> {
    return Object.fromEntries(this.enabled)
  }

  clear(): void {
    this.enabled.clear()
  }

  /** 触发一次持久化；未注入回调或回调抛错时返回 false。 */
  async persist(): Promise<boolean> {
    if (!this.persistFn) return false
    try {
      return await this.persistFn(this.snapshot())
    } catch {
      return false
    }
  }
}
