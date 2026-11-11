/**
 * S3 DSH 原生 Agent 推理引擎。
 *
 * 实现 `LumegazeEngine` 接缝（S2 冻结契约），通过 `setEngine(engine)` 无侵入注入：
 * - 按 `sessionId` 缓存 DSH Agent（一个 sessionId 一个 Agent，多行者并发隔离）。
 * - provider / model 跟随 `ctx.agentDefaultModel.currentSelection()`；服务缺失或
 *   selection 为空时记日志并回 `MODEL_NOT_CONFIGURED`，绝不崩溃。
 * - Prompt = 面板 personaPrompt + 输入内容；`game_tick` 的结构化 content 序列化进
 *   Prompt。
 * - 响应文本的权威来源是 `agent.session` 的 durable `assistant/message` 事件，
 *   不是内存累加。
 * - LLM 输出经 `parseDecision` 强校验 + 兜底修复；非法结构绝不透传客户端。
 * - `ctx.effect` 注册 dispose：fiber 卸载时释放全部缓存 Agent。
 *
 * 记忆：状态 A（billion-context 已接入）依赖其自动生效；状态 B（未接入）仅内存
 * 保留当前 Agent 会话窗口，绝不落盘 / 自建向量库。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type Session } from '@deepseek-ai/dsh-session';
import { type Config as LumegazeConfig } from './config.js';
import { type BillionDependencyInfo, type MemoryMode } from './billion-context.js';
import { type LumegazeEngine, type EngineChatInput } from './engine.js';
import { LumegazeLogger } from './logger.js';
import { type ServerClient, type ServerClientOptions } from './server-client.js';
/** 引擎句柄：LumegazeEngine + 依赖状态暴露 + 资源释放。 */
export interface AgentEngineHandle extends LumegazeEngine {
    getDependencyStatus(): BillionDependencyInfo;
    getMemoryMode(): MemoryMode;
    /** 在独立异步任务中调用：检测并按需安装 billion-context。 */
    ensureBillionInstalled(): Promise<BillionDependencyInfo>;
    /** 释放缓存的全部 Agent（由 ctx.effect 注册，fiber 卸载时调用）。 */
    dispose(): Promise<void>;
}
export interface AgentEngineOptions {
    /** 复用 apply 已构造的 LumegazeLogger；缺省内部自建。 */
    logger?: LumegazeLogger;
    /** 注入预置的 serverClient（测试用）；缺省按 config.serverUrl 创建。 */
    serverClient?: ServerClient;
    /** serverClient 创建参数（测试注入超时 / fetch）。 */
    serverClientOptions?: ServerClientOptions;
}
/** 组装 Prompt：面板人设 + 输入内容 + 决策 Schema 约束。 */
export declare function buildPrompt(personaPrompt: string, input: EngineChatInput): string;
/**
 * 从 session 的 durable 事件中聚合本轮最终 assistant 文本（与 dsh-headless
 * `summarize()` 同源：只认 `turn/start` 之后、最后一个 `assistant/message` 的
 * text block 拼接）。
 */
export declare function summarizeAssistantText(session: Session, firstSeq: number): string;
/**
 * 创建 DSH 原生 Agent 推理引擎。
 *
 * `apply()` 同步体不会 await 这里的任何安装行为；`ensureBillionInstalled()` 由
 * 调用方放进独立异步 effect 中 fire-and-forget 触发。
 */
export declare function createAgentEngine(ctx: Context, config: LumegazeConfig, options?: AgentEngineOptions): AgentEngineHandle;
export declare function isStructuredContent(value: unknown): boolean;
//# sourceMappingURL=agent-engine.d.ts.map