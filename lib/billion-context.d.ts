/**
 * billion-context 依赖检测 / 自动安装 / 状态暴露（规格第三章 / 第七章 2、4）。
 *
 * 已核实事实（docs/billion-context-hook-finding.md）：
 * - billion-context 是 bundle，仅插入 `bili-native` / `bili-compaction-gate` 两个
 *   Loader 行并在 LLM 流层 hook；**不存在可被第三方调用的对外记忆 API**。
 * - 因此本插件只做「状态检测 + 依赖其自动生效」，绝不调用其 API、绝不自建
 *   向量库 / 记忆落盘。
 *
 * 检测与安装：
 * - `ctx.pluginManager.listBundles()` 中 `name === 'billion-context'` 且
 *   `installed && enabled` → 状态 A（长期记忆已接入）。
 * - 缺失时在**独立异步任务**中调用 `ctx.pluginManager.installBundle('billion-context',
 *   { enabled: true })`；按 `ChangeResult.application` 分类记日志并短期降级。
 * - **禁止卸载 / 修改 billion-context**：本模块只有 listBundles / installBundle 两个调用面。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { LumegazeLogger } from './logger.js';
/** billion-context bundle 名。 */
export declare const BILLION_CONTEXT_BUNDLE = "billion-context";
export type BillionDependencyStatus = 'installed' | 'missing' | 'installing' | 'restart-required' | 'overridden' | 'cancelled' | 'failed' | 'unknown';
/** 记忆模式（供 S4 面板展示）。 */
export type MemoryMode = 'long' | 'short';
export interface BillionDependencyInfo {
    status: BillionDependencyStatus;
    installed: boolean;
    enabled: boolean;
    /** 最近一次 installBundle 的 application（若发生）。 */
    application?: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled';
    /** 失败时的 ManagementError.code。 */
    error?: string;
    message: string;
}
export interface BillionContextService {
    /** 只检测（不安装），刷新并返回当前状态。 */
    detect(): Promise<BillionDependencyInfo>;
    /** 检测；未安装则尝试安装（调用方须在独立异步任务中调用）。 */
    ensureInstalled(): Promise<BillionDependencyInfo>;
    getDependencyStatus(): BillionDependencyInfo;
    getMemoryMode(): MemoryMode;
}
export declare function createBillionContextService(ctx: Context, logger: LumegazeLogger): BillionContextService;
//# sourceMappingURL=billion-context.d.ts.map