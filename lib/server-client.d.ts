/**
 * 游戏服务端 HTTP 客户端（本期预留 + 日志）。
 *
 * 规格第二章 6 / 第六章 4：配置了 serverUrl 时按需发起 HTTP；任何失败
 * （非 2xx / 超时 / 网络错误）只写 `[server]` 日志，绝不抛到调用方、绝不阻断
 * AI 推理流程。serverUrl 为空时零 HTTP 请求。
 *
 * 本模块不引入额外依赖：使用 Node 20 内置 `fetch` + `AbortSignal.timeout`。
 */
import type { LumegazeLogger } from './logger.js';
/** 默认超时 5s（规格第二章 6）。 */
export declare const DEFAULT_SERVER_TIMEOUT_MS = 5000;
export interface ServerRequestResult {
    ok: boolean;
    status?: number;
    error?: string;
}
export interface ServerClientOptions {
    /** 超时毫秒；默认 5000。 */
    timeoutMs?: number;
    /** 自定义 fetch（测试注入用）；默认全局 fetch。 */
    fetchImpl?: typeof fetch;
}
export interface ServerClient {
    /** 请求 `{serverUrl}{path}`；失败返回 ok:false 而不抛错。 */
    request(path: string, init?: RequestInit): Promise<ServerRequestResult>;
    /** 健康检查便捷方法（GET `/healthz`）。 */
    requestHealth(): Promise<ServerRequestResult>;
    /** 读取最近一次失败摘要（仅日志用途）。 */
    get lastError(): string | undefined;
    /** 释放（本期无持久资源，保留接口）。 */
    dispose(): void;
}
export declare function createServerClient(logger: LumegazeLogger, getServerUrl: () => string, options?: ServerClientOptions): ServerClient;
//# sourceMappingURL=server-client.d.ts.map