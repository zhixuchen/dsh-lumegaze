/**
 * 插件本地 WebSocket 服务端（规格第二章 3 / 第四章 / 第七章 3）。
 *
 * 约束：
 * - 只监听 127.0.0.1，绝不绑定 0.0.0.0（`ss -ltn` 可证）。
 * - 握手鉴权：authSecret 非空时校验 upgrade 头 `x-lumegaze-auth`（恒定时间比较）；
 *   为空则不鉴权（Q2 冻结裁决）。
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
    /** 引擎解析器；缺省用模块级槽位 getEngine()。 */
    engine?: () => LumegazeEngine;
}
export declare class WsGateway {
    private readonly options;
    private wss;
    private readonly clients;
    constructor(options: WsGatewayOptions);
    /** 启动服务。host 固定 127.0.0.1；端口非法时只记日志，不启动。 */
    start(port: number): void;
    /** 关闭服务并断开现有客户端；用于 ctx.effect 清理。 */
    stop(): Promise<void>;
    get address(): ReturnType<WebSocketServer['address']> | null;
    private onConnection;
    private handleFrame;
    private handleToggle;
    private handleInference;
    private send;
}
//# sourceMappingURL=ws-server.d.ts.map