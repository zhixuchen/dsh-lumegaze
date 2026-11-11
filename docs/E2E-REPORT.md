# 端到端联调报告（T6）

> 脚本：`scripts/e2e-check.mjs`（已纳入 `pnpm verify` 链）
> 运行：`node scripts/e2e-check.mjs`
> 结论：**27 / 27 通过**，覆盖完成定义列出的 5 类场景。

## 1. 测试拓扑

- 真实 `apply(ctx, config)`：`Context`（cordis）加载插件，走真实 `ctx.effect` 生命周期。
- 真实 `WsGateway`：真起 `ws` 服务端（`127.0.0.1`），真 `ws` 客户端连接、发送、收包。
- 真实 `AgentEngine`：`createAgentEngine` → `ctx.agents.create` → `followup` / `whenIdle` → durable `assistant/message` 事件 → `parseDecision`。
- 进程内假实现（真实 DSH 运行时 / 真实模型无法无头跑）：`ctx.agents` / `ctx.agentDefaultModel` / `ctx.pluginManager`；假 Agent 按 sessionId 返回指定决策文本。
- 跨仓桥接：`registerHooks` 加载观灵域客户端真实 `adaptPluginOutboundToDecision`，验证「客户端侧提交 action」。

## 2. 场景覆盖与结果

| 场景 | 覆盖点 | 关键断言 | 结果 |
| --- | --- | --- | --- |
| 1 | 开关开 → `game_tick`(感知包) → 插件回包结构化 → 客户端重建 action | 回包 8 字段、sessionId/userId 回填、text 来自 durable 事件、emotion 推断、action[0] 完整动作对象（type/target/give/want/extra）、客户端 `adaptPluginOutboundToDecision` 接受且字段无损 | ✅ 11/11 |
| 2 | 开关关 → `WALKER_AI_DISABLED` 拦截 | `success=false`、`errorCode=WALKER_AI_DISABLED`、`errorMsg` 精确、引擎零调用 | ✅ 4/4 |
| 3a | 服务端 URL 配错（连接拒绝） | AI 仍 `success=true`、仅记 `[server]` 失败日志 | ✅ 2/2 |
| 3b | 服务端超时（>5s） | AI 在 <2s 返回（不阻塞）、超时后记录失败日志 | ✅ 2/2 |
| 4 | 非法 LLM 输出 → 兜底不崩溃 | `success=false`、`errorCode=INVALID_LLM_OUTPUT`、action 空、后续请求仍成功 | ✅ 4/4 |
| 5 | 两个 sessionId 并发隔离 | 回包 sessionId/userId 不串话、动作不串话 | ✅ 3/3 |
| 附加 | billion-context 已装不卸载 / 不修改 | `installCalls === 0` | ✅ 1/1 |

合计：**27 passed, 0 failed**。

## 3. 客户端侧证据（观灵域 `client/`）

- `client/tests/pluginT5.test.ts`：**17 / 17 通过**，含
  - 「game_tick 端到端：感知包 → 插件回包 → 唯一 /agent 连接提交 action」
  - 「插件失败回包（WALKER_AI_DISABLED）不提交 action」
  - 「动作不在白名单时被拒绝」「插件 text 为完整决策 JSON 时直接采用」
- 运行命令：
  `cd /Users/admin/观灵域/client && node --import ./tests/support/register.mjs --test tests/pluginT5.test.ts`

## 4. 构建与既有校验链

| 命令 | 结果 |
| --- | --- |
| `pnpm build` | 退出 0（tsc） |
| `pnpm verify` | 退出 0 |
| `scripts/verify-config.mjs` | PASSED（6 volatile 字段） |
| `scripts/disposer-check.mjs` | PASSED（2 effects 装载/拆除） |
| `scripts/ws-gateway-check.mjs` | PASSED（S2 验收） |
| `scripts/agent-engine-check.mjs` | 64 passed / 0 failed |
| `scripts/client-panel-check.mjs` | 38 passed / 0 failed |
| `scripts/e2e-check.mjs` | 27 passed / 0 failed |

## 5. 未实跑（明确标注）

| 项 | 说明 |
| --- | --- |
| 真实 DSH profile 内加载 / 启用 / 面板渲染 | 需 DSH GUI 安装启用插件；用真实 `Context` + `apply()` 替代 |
| Tauri WebView 内真实 `WebSocket` + `?token=` 握手 | 用 Node `ws` 客户端真实握手 + 客户端单测覆盖 |
| billion-context 长期记忆真实生效 | 需真实 profile + 真实模型 |
| 服务端业务数据接口同步 | 服务端无该接口，本期预留 |

> 结论仅陈述已执行验证的事实；未实跑项见 `docs/DELIVERY-NOTES.md` §6。
