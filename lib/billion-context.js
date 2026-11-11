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
import { errorMessage } from './logger.js';
/** billion-context bundle 名。 */
export const BILLION_CONTEXT_BUNDLE = 'billion-context';
function unknownInfo(message) {
    return { status: 'unknown', installed: false, enabled: false, message };
}
function resolveManager(ctx) {
    try {
        const service = ctx.reflect.get('pluginManager');
        if (service &&
            typeof service.listBundles === 'function' &&
            typeof service.installBundle === 'function') {
            return service;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
export function createBillionContextService(ctx, logger) {
    let info = unknownInfo('尚未检测');
    async function detect() {
        const manager = resolveManager(ctx);
        if (!manager) {
            info = unknownInfo('pluginManager 服务不可用，跳过检测');
            logger.dependency('billion-context detection skipped: pluginManager unavailable');
            return info;
        }
        try {
            const bundles = await manager.listBundles();
            const found = Array.isArray(bundles)
                ? bundles.find((bundle) => bundle && bundle.name === BILLION_CONTEXT_BUNDLE)
                : undefined;
            if (found && found.installed === true && found.enabled === true) {
                info = {
                    status: 'installed',
                    installed: true,
                    enabled: true,
                    message: 'billion-context 已安装并启用（长期记忆已接入）',
                };
            }
            else if (found && found.installed === true) {
                info = {
                    status: 'installed',
                    installed: true,
                    enabled: false,
                    message: 'billion-context 已安装但未启用（短期记忆降级）',
                };
            }
            else {
                info = {
                    status: 'missing',
                    installed: false,
                    enabled: false,
                    message: 'billion-context 未安装',
                };
            }
        }
        catch (error) {
            info = unknownInfo(`billion-context 检测异常：${errorMessage(error)}`);
            logger.warn('billion-context detection failed: %s', errorMessage(error));
        }
        logger.dependency('billion-context dependency: %s', info.message);
        return info;
    }
    async function ensureInstalled() {
        const current = await detect();
        // 已安装（无论是否启用）：跳过，绝不调用 installBundle，也不修改其配置。
        if (current.installed) {
            logger.dependency('billion-context already installed; skip installBundle (enabled=%s)', current.enabled);
            return current;
        }
        if (current.status === 'installing')
            return info;
        const manager = resolveManager(ctx);
        if (!manager) {
            info = { ...current, status: 'failed', message: 'pluginManager 不可用，无法安装 billion-context' };
            logger.warn('billion-context install skipped: pluginManager unavailable');
            return info;
        }
        info = { ...current, status: 'installing', message: '正在安装 billion-context…' };
        logger.dependency('billion-context not installed; starting detached install');
        try {
            const result = await manager.installBundle(BILLION_CONTEXT_BUNDLE, { enabled: true });
            const application = result?.application;
            if (application === 'applied') {
                info = {
                    status: 'installed',
                    installed: true,
                    enabled: true,
                    application,
                    message: 'billion-context 已安装并应用（长期记忆已接入）',
                };
                logger.dependency('billion-context install applied');
            }
            else if (application === 'restart-required') {
                info = {
                    status: 'restart-required',
                    installed: true,
                    enabled: false,
                    application,
                    message: 'billion-context 需重启后生效，当前短期记忆降级',
                };
                logger.warn('billion-context install requires restart; running in short-term memory mode');
            }
            else if (application === 'overridden' || application === 'cancelled') {
                info = {
                    status: application,
                    installed: false,
                    enabled: false,
                    application,
                    message: `billion-context 安装被 ${application}`,
                };
                logger.warn('billion-context install %s; running in short-term memory mode', application);
            }
            else {
                info = {
                    status: 'failed',
                    installed: false,
                    enabled: false,
                    application,
                    error: result?.error?.code,
                    message: 'billion-context 安装失败，进入短期记忆降级',
                };
                logger.warn('billion-context install failed (%s); running in short-term memory mode', result?.error?.code ?? 'unknown');
            }
        }
        catch (error) {
            info = {
                status: 'failed',
                installed: false,
                enabled: false,
                message: `billion-context 安装异常，进入短期记忆降级：${errorMessage(error)}`,
            };
            logger.warn('billion-context install threw: %s', errorMessage(error));
        }
        return info;
    }
    return {
        detect,
        ensureInstalled,
        getDependencyStatus: () => info,
        getMemoryMode: () => (info.installed && info.enabled ? 'long' : 'short'),
    };
}
//# sourceMappingURL=billion-context.js.map