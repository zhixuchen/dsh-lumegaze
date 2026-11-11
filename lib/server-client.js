/**
 * 游戏服务端 HTTP 客户端（本期预留 + 日志）。
 *
 * 规格第二章 6 / 第六章 4：配置了 serverUrl 时按需发起 HTTP；任何失败
 * （非 2xx / 超时 / 网络错误）只写 `[server]` 日志，绝不抛到调用方、绝不阻断
 * AI 推理流程。serverUrl 为空时零 HTTP 请求。
 *
 * 本模块不引入额外依赖：使用 Node 20 内置 `fetch` + `AbortSignal.timeout`。
 */
/** 默认超时 5s（规格第二章 6）。 */
export const DEFAULT_SERVER_TIMEOUT_MS = 5000;
function joinUrl(base, path) {
    const trimmed = base.replace(/\/+$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${trimmed}${suffix}`;
}
export function createServerClient(logger, getServerUrl, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_SERVER_TIMEOUT_MS;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    let lastError;
    async function request(path, init) {
        const base = getServerUrl();
        if (typeof base !== 'string' || base.trim().length === 0) {
            // serverUrl 为空：零 HTTP 请求。调用方也应先判空，这里只是兜底。
            logger.server('server request skipped: serverUrl not configured');
            return { ok: false, error: 'serverUrl 未配置' };
        }
        const target = joinUrl(base, path);
        try {
            if (typeof fetchImpl !== 'function') {
                throw new Error('global fetch unavailable');
            }
            const response = await fetchImpl(target, {
                ...init,
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (!response.ok) {
                lastError = `HTTP ${response.status}`;
                logger.server('server request %s failed: HTTP %d', path, response.status);
                return { ok: false, status: response.status, error: `HTTP ${response.status}` };
            }
            logger.server('server request %s ok: HTTP %d', path, response.status);
            return { ok: true, status: response.status };
        }
        catch (error) {
            lastError = errorMessage(error);
            logger.server('server request %s failed: %s', path, lastError);
            return { ok: false, error: lastError };
        }
    }
    return {
        request,
        requestHealth: () => request('/healthz'),
        get lastError() {
            return lastError;
        },
        dispose: () => {
            lastError = undefined;
        },
    };
}
function errorMessage(error) {
    if (error instanceof Error)
        return `${error.name}: ${error.message}`;
    if (typeof error === 'string')
        return error;
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
}
//# sourceMappingURL=server-client.js.map