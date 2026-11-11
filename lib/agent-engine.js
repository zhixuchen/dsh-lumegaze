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
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session';
import { readVolatile } from './config.js';
import { createBillionContextService, } from './billion-context.js';
import { parseDecision, deriveEmotion, decisionReplyText } from './decision.js';
import { sanitizeActions } from './protocol.js';
import { LumegazeLogger, errorMessage } from './logger.js';
import { createServerClient } from './server-client.js';
/** 插件显示名（日志用）。 */
const LOG_NAME = 'dsh-lumegaze';
function createRuntimeLogger(ctx, config) {
    return new LumegazeLogger({
        base: ctx.logger(LOG_NAME),
        isDetailed: () => readVolatile(config.logEnabled) === true,
        secrets: () => {
            const secret = readVolatile(config.authSecret);
            return secret ? [secret] : [];
        },
    });
}
function resolveAgents(ctx) {
    try {
        const service = ctx.reflect.get('agents');
        if (service && typeof service.create === 'function')
            return service;
        return undefined;
    }
    catch {
        return undefined;
    }
}
function resolveDefaultModel(ctx) {
    try {
        const service = ctx.reflect.get('agentDefaultModel');
        if (!service || typeof service.currentSelection !== 'function')
            return undefined;
        const selection = service.currentSelection();
        if (!selection ||
            typeof selection.provider !== 'string' ||
            selection.provider.length === 0 ||
            typeof selection.model !== 'string' ||
            selection.model.length === 0) {
            return undefined;
        }
        return selection;
    }
    catch {
        return undefined;
    }
}
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function serializeInput(content) {
    if (typeof content === 'string')
        return content;
    try {
        return JSON.stringify(content ?? null);
    }
    catch {
        return String(content);
    }
}
const DECISION_SCHEMA_PROMPT = [
    '请严格只输出一个 JSON 对象，不要输出任何解释或额外文字，结构如下：',
    '{',
    '  "thought": "你的内部思考（字符串）",',
    '  "action": { "type": "<动作>", "target": "<可选>", "give": [], "want": [], "extra": {} },',
    '  "reply_owner": "给观者主人的回复",',
    '  "reply_other": "给其他行者的对话"',
    '}',
    `action.type 只能取：wait / move / collect / craft / give / discard / trade_propose / ally_propose / rescue / attack / place_stele / say。`,
].join('\n');
/** 组装 Prompt：面板人设 + 输入内容 + 决策 Schema 约束。 */
export function buildPrompt(personaPrompt, input) {
    const persona = typeof personaPrompt === 'string' ? personaPrompt.trim() : '';
    const parts = [];
    if (persona.length > 0)
        parts.push(`[行者人设]\n${persona}`);
    parts.push(`[本轮输入]\n${serializeInput(input.content)}`);
    parts.push(DECISION_SCHEMA_PROMPT);
    return parts.join('\n\n');
}
function isTextBlock(block) {
    return block.type === 'text';
}
/**
 * 从 session 的 durable 事件中聚合本轮最终 assistant 文本（与 dsh-headless
 * `summarize()` 同源：只认 `turn/start` 之后、最后一个 `assistant/message` 的
 * text block 拼接）。
 */
export function summarizeAssistantText(session, firstSeq) {
    let started = false;
    let text = '';
    const end = Number(session.seq);
    for (let seq = Number(firstSeq); seq < end; seq++) {
        const event = session.eventAt(SessionSeq(seq));
        if (!event)
            continue;
        if (event.type === 'turn/start') {
            started = true;
            continue;
        }
        if (!started)
            continue;
        if (event.type === 'assistant/message') {
            const joined = event.data.message.content
                .filter(isTextBlock)
                .map((block) => block.text)
                .join('');
            if (joined.length > 0)
                text = joined;
        }
    }
    return text;
}
/**
 * 创建 DSH 原生 Agent 推理引擎。
 *
 * `apply()` 同步体不会 await 这里的任何安装行为；`ensureBillionInstalled()` 由
 * 调用方放进独立异步 effect 中 fire-and-forget 触发。
 */
export function createAgentEngine(ctx, config, options = {}) {
    const logger = options.logger ?? createRuntimeLogger(ctx, config);
    const billion = createBillionContextService(ctx, logger);
    const serverClient = options.serverClient ?? createServerClient(logger, () => readVolatile(config.serverUrl), options.serverClientOptions);
    const agents = new Map();
    function fail(errorCode, errorMsg) {
        return { text: '', emotion: 'normal', action: [], success: false, errorCode, errorMsg };
    }
    // M4：同一 sessionId 的推理按到达顺序串行执行。DSH Agent 的 durable session 是
    // 共享的：并发调用会各自记录 firstSeq 后读到同一段事件，summarize 取最后一条
    // assistant/message 导致串话。per-sessionId promise 链保证先到先完成。
    const sessionGates = new Map();
    function enqueueSession(sessionId, task) {
        const previous = sessionGates.get(sessionId) ?? Promise.resolve();
        // 无论前序任务成功/失败都执行本次任务；settled 永远 resolve，保持链不断。
        const run = previous.then(task, task);
        const settled = run.then(() => undefined, () => undefined);
        sessionGates.set(sessionId, settled);
        void settled.then(() => {
            if (sessionGates.get(sessionId) === settled)
                sessionGates.delete(sessionId);
        });
        return run;
    }
    async function chat(input) {
        return enqueueSession(input.sessionId, () => runChat(input));
    }
    async function runChat(input) {
        try {
            // 服务端 HTTP（预留）：serverUrl 为空时零请求；非空时按需请求，
            // 失败仅记日志，不阻断 AI 流程。不 await：与推理并行，避免阻塞。
            if (readVolatile(config.serverUrl).trim().length > 0) {
                void serverClient.requestHealth().catch(() => undefined);
            }
            const selection = resolveDefaultModel(ctx);
            if (!selection) {
                logger.dependency('agentDefaultModel unavailable or selection empty; skip agent call');
                return fail('MODEL_NOT_CONFIGURED', '未配置可用的默认模型（ctx.agentDefaultModel）');
            }
            const registry = resolveAgents(ctx);
            if (!registry) {
                logger.dependency('agents service unavailable; cannot run agent inference');
                return fail('ENGINE_NOT_READY', 'Agent 服务未注册（ctx.agents）');
            }
            let handle = agents.get(input.sessionId);
            if (!handle) {
                try {
                    handle = await registry.create({
                        sessionId: SessionId(input.sessionId),
                        meta: { cwd: process.cwd() },
                        agentOptions: { provider: selection.provider, model: selection.model },
                    });
                    agents.set(input.sessionId, handle);
                    logger.dependency('agent created for session=%s provider=%s model=%s', input.sessionId, selection.provider, selection.model);
                }
                catch (error) {
                    logger.error('agent create failed for session %s: %s', input.sessionId, errorMessage(error));
                    return fail('ENGINE_ERROR', '创建 Agent 失败');
                }
            }
            const agent = handle.agent;
            const prompt = buildPrompt(readVolatile(config.personaPrompt), input);
            const firstSeq = agent.session.seq;
            try {
                agent.followup(createUserMessage({
                    content: [{ type: 'text', text: prompt }],
                    source: { kind: 'user' },
                }));
                await agent.whenIdle();
            }
            catch (error) {
                logger.error('agent inference failed for session %s: %s', input.sessionId, errorMessage(error));
                return fail('ENGINE_ERROR', 'Agent 推理失败');
            }
            const rawText = summarizeAssistantText(agent.session, firstSeq);
            const parsed = parseDecision(rawText);
            if (!parsed.ok) {
                logger.inference('session %s invalid LLM output: %s (%s)', input.sessionId, parsed.code, parsed.reason);
                return fail('INVALID_LLM_OUTPUT', `LLM 输出不符合决策结构：${parsed.reason}`);
            }
            const decision = parsed.decision;
            const text = decisionReplyText(decision, rawText);
            const emotion = deriveEmotion(decision.thought, decision.reply_owner, decision.reply_other);
            // 出站 action[] 元素为完整动作对象的 JSON 字符串（含 type/target/give/want/extra）。
            // 观灵域客户端 `parseActionCandidate` 已支持「`{...}` JSON 字符串 → 直接作为对象」，
            // 因此可无损重建动作；只发裸类型会丢失 target/give/want 等字段。
            // S-M2-1：出站前强校验；若动作对象因超限被整项丢弃，显式回失败 + 错误码，
            // 避免「success:true + action:[]」让客户端误判为引擎本就无动作。
            let actionDropped = 0;
            const action = sanitizeActions([JSON.stringify(decision.action)], (reason, item) => {
                actionDropped += 1;
                logger.warn('session %s action dropped: %s (len=%d)', input.sessionId, reason, item.length);
            });
            logger.inference('session %s inference ok: action=%s emotion=%s', input.sessionId, decision.action.type, emotion);
            if (actionDropped > 0 && action.length === 0) {
                return { text, emotion, action, success: false, errorCode: 'ACTION_TOO_LARGE', errorMsg: '动作超过大小上限，已整项丢弃' };
            }
            return { text, emotion, action, success: true, errorCode: '', errorMsg: '' };
        }
        catch (error) {
            // 引擎实现绝不把异常抛给网关层。
            logger.error('engine.chat unexpected failure for session %s: %s', input.sessionId, errorMessage(error));
            return fail('ENGINE_ERROR', 'AI 推理引擎内部错误');
        }
    }
    async function dispose() {
        // S-M4-1：同步清空串行闸门，避免 dispose 后仍有排队任务在已释放的 Agent 上执行。
        sessionGates.clear();
        const handles = [...agents.values()];
        agents.clear();
        for (const item of handles) {
            try {
                await item.dispose();
            }
            catch (error) {
                logger.error('agent dispose failed: %s', errorMessage(error));
            }
        }
        serverClient.dispose();
    }
    // fiber 卸载时逆序释放全部缓存 Agent。
    ctx.effect(() => {
        return async () => {
            await dispose();
            logger.dependency('agent engine disposed');
        };
    }, 'lumegaze: agent-engine');
    return {
        chat,
        getDependencyStatus: () => billion.getDependencyStatus(),
        getMemoryMode: () => billion.getMemoryMode(),
        ensureBillionInstalled: () => billion.ensureInstalled(),
        dispose,
    };
}
// 供测试 / 内省：判定输入是否结构化对象。
export function isStructuredContent(value) {
    return isPlainObject(value);
}
//# sourceMappingURL=agent-engine.js.map