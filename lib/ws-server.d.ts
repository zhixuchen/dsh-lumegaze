/**
 * 插件本地 WebSocket 服务端（规格第二章 3 / 第四章 / 第七章 3）。
 *
 * 约束：
 * - 只监听 127.0.0.1，绝不绑定 0.0.0.0（`ss -ltn` 可证）。
 * - 握手鉴权：authSecret 非空时校验两种承载——upgrade 头 `x-lumegaze-auth` 或
 *   URL 查询参数 `?token=`（浏览器 / Tauri WebView 的 `WebSocket` 无法自定义
 *   upgrade 头，故需 query 承载）；两者均做恒定时间比较，任一正确即放行，
 *   都缺失/错误则 401。为空则不鉴权（Q2 冻结裁决，向后兼容）。
 * - 帧防护：`maxPayload` 限制超大帧；非法 JSON / 空 userId / 空 sessionId 一律
 *   回错误报文，服务不崩溃。
 * - 会话隔离：每个 sessionId 的出站报文都以当次入站的 sessionId / userId 回填。
 * - 开关隔离：chat / game_tick 先查 userId 开关，关闭时直接拦截，不调用引擎。
 */
import { WebSocketServer } from 'ws';
import { type LumegazeEngine } from './engine.js';
import { type LumegazeLogger } from './logger.js';
import type { SessionRegistry } from './sessions.js';
import type { WalkerSwitches } from './switches.js';
/** 单帧上限 256 KiB。 */
export declare const MAX_FRAME_BYTES: number;
export interface WsGatewayOptions {
    switches: WalkerSwitches;
    sessions: SessionRegistry;
    logger: LumegazeLogger;
    authSecret: () => string;
    /**
     * 插件总开关的运行期判定（M1）：为 false 时 chat / game_tick 一律回
     * `PLUGIN_DISABLED` 且不调用引擎。缺省视为开启（保持向后兼容）。
     */
    isEnabled?: () => boolean;
    /** 引擎解析器；缺省用模块级槽位 getEngine()。 */
    engine?: () => LumegazeEngine;
}
/**
 * 读取 upgrade 请求 URL 中的 `?token=` / `&token=` 参数（浏览器 / WebView 承载）。
 *
 * 客户端以 `encodeURIComponent(token)` 编码，这里解码回原文再比较；解码失败
 * （畸形百分号序列）时退回原始片段，仍交由恒定时间比较判定，不抛错、不泄露。
 */
export declare function readQueryToken(url: string | undefined): string | undefined;
export declare class WsGateway {
    private readonly options;
    private wss;
    private readonly clients;
    /**
     * S-4：stop() 关闭窗口标志。窗口内 `wss` 已置空但旧实例尚未 close 完成，
     * `start()` 必须延后，避免旧实例关闭与新实例并存。
     */
    private closing;
    /** 关闭窗口内收到的 start 端口；stop() 完成后补启。 */
    private pendingStartPort;
    /** 进行中的 stop() 句柄：重复 stop 幂等。 */
    private stopPromise;
    /** fiber dispose 后置 true：停止后不再补启延迟 start。 */
    private disposed;
    constructor(options: WsGatewayOptions);
    /** 启动服务。host 固定 127.0.0.1；已在运行时忽略，端口非法时只记日志，不启动。 */
    start(port: number): void;
    /**
     * 关闭服务并断开现有客户端；用于运行期停用。
     *
     * S-4：置 `closing` 标志；窗口内到达的 `start()` 只记录端口，待关闭完成后补启。
     * 重复调用返回同一个进行中的 stop，保证幂等。
     */
    stop(): Promise<void>;
    /**
     * fiber dispose 路径：停止网关且不再补启关闭窗口内记录的延迟 start。
     * 与 {@link stop} 的区别只在 `disposed` 标志。
     */
    dispose(): Promise<void>;
    /** stop() 完成后补启关闭窗口内记录的 start（dispose 后不再补启）。 */
    private flushPendingStart;
    get address(): ReturnType<WebSocketServer['address']> | null;
    /** M1：网关是否处于运行态（start 成功且尚未 stop），供运行期启停判定。 */
    isRunning(): boolean;
    /** S-4：是否处于 stop() 关闭窗口（wss 已置空、旧实例尚未 close 完成）。 */
    isClosing(): boolean;
    private onConnection;
    private handleFrame;
    private handleToggle;
    private handleInference;
    private send;
}
//# sourceMappingURL=ws-server.d.ts.map