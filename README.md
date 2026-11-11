# dsh-lumegaze（观灵域行者 AI 网关）

《观灵域》行者 AI 的中枢网关插件。插件在本地回环地址提供 WebSocket 接口，供
观灵域 Tauri 客户端连接；行者 AI 推理全部复用 DSH 原生 Agent 能力，不直接调用
Ollama 或任何第三方大模型 API。

> 市场简介：观灵域行者 AI 网关，需配套观灵域 Tauri 客户端使用。

## 安装

```bash
dsh plugin add dsh-lumegaze
```

插件声明了 `dsh.bundle.patch`（`dsh.bundle.patch.yml`），安装后会在 profile 的
Loader 中插入一行：

```yaml
- id: lumagaze
  name: dsh-lumegaze
```

行 id `lumegaze` 同时是本插件的 settings namespace：
`ctx.settings.describe()` / `ctx.settings.update('lumegaze', ...)` 都以它为键。

## 配置

配置项全部持久化在 profile patch，DSH 重启保留。`volatile` 字段可由设置页在线
编辑；运行时解析后会被 cordis 包成 `Volatile<T>`。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `wsPort` | number | `8790` | 本地 WebSocket 端口，仅绑定 `127.0.0.1` |
| `serverUrl` | string | `""` | 游戏服务端 URL；空值不发起 HTTP 交互 |
| `personaPrompt` | string | `""` | 行者通用人设 Prompt |
| `authSecret` | string | `""` | 插件 WS 握手鉴权密钥；空值不鉴权 |
| `logEnabled` | boolean | `false` | 是否输出详细运行日志 |
| `walkerAiSwitches` | `Record<string, boolean>` | `{}` | 运行态：`userId → walkerAiEnable` |

> S2 已落地本地 WebSocket 服务端、第四章协议编解码、userId 开关隔离、分级日志。
> S3 已落地 DSH 原生 Agent 推理引擎（`ctx.agents` + `agentDefaultModel`）、LLM
> 决策 JSON 强校验与兜底、billion-context 检测/自动安装/降级、服务端 HTTP 预留。
> 设置面板在 S4。

## 通信协议（S2）

插件在 `127.0.0.1:wsPort`（默认 8790）提供 WebSocket。`authSecret` 非空时，
握手须携带 upgrade 头 `x-lumegaze-auth`（恒定时间比较）；为空则不鉴权。

- 入站：`{sessionId,userId,type:"chat"|"game_tick"|"toggle_walker_ai",content,timestamp}`
- 出站：`{sessionId,userId,text,emotion:"normal"|"happy"|"sad"|"shy"|"angry"|"calm",action:string[],success,errorCode,errorMsg}`
- `toggle_walker_ai` 的 `content` 为布尔值，写 `walkerAiSwitches[userId]` 并经
  `ctx.settings.mutate` 持久化到 profile patch（DSH 重启保留）。
- 开关关闭时，`chat` / `game_tick` 直接回 `WALKER_AI_DISABLED`，**不调用引擎**。
- 非法 JSON / 空 `sessionId` / 空 `userId` / 非法 `type` / 超大帧均被拒绝且服务不崩溃。

### S3 Agent 引擎接缝

`src/engine.ts` 导出 `LumegazeEngine` 接口、默认 `unavailableEngine`
（回 `ENGINE_NOT_READY`），以及模块级可替换槽位 `setEngine(engine)` /
`getEngine()`。S3 用 `setEngine(realEngine)` 无侵入注入真实 Agent 推理，S2 不实现
任何真实调用。

### S3 Agent 推理引擎

`src/agent-engine.ts` 的 `createAgentEngine(ctx, config)` 返回 `LumegazeEngine`
（另附 `getDependencyStatus()` / `getMemoryMode()` / `ensureBillionInstalled()` /
`dispose()`），由 `src/index.ts` 在 `apply()` 内经 `setEngine` 注入：

- 按 `sessionId` 缓存 DSH Agent（一个 sessionId 一个 Agent，多行者并发隔离），
  `ctx.effect` 注册 dispose。
- provider / model 跟随 `ctx.agentDefaultModel.currentSelection()`；服务缺失或
  selection 为空时记日志并回 `MODEL_NOT_CONFIGURED`，不崩溃。
- Prompt = 面板 `personaPrompt` + 输入内容；`game_tick` 的结构化 content 序列化
  进 Prompt。
- 响应文本取自 `agent.session` 的 durable `assistant/message` 事件（不是内存累加）。
- `src/decision.ts` 对 LLM 输出做 JSON 强校验 + 兜底修复（剥围栏 / 提取首个
  `{...}` / 补全括号），非法结构回 `success:false,errorCode:"INVALID_LLM_OUTPUT"`，
  绝不透传给客户端；`action` 数组只取 12 项白名单内的合法 `action.type`。

### S3 billion-context 与降级

`src/billion-context.ts` 用 `ctx.pluginManager.listBundles()` 检测
`name === 'billion-context'`；已安装则跳过、绝不调用 `installBundle`，未安装时在
**独立异步 effect**（`apply()` 同步体不 await）调用
`installBundle('billion-context', {enabled:true})`，并按 `ChangeResult.application`
（`applied` / `restart-required` / `failed` / `overridden` / `cancelled`）分类记日志。
状态 A（已接入）依赖其自动生效；状态 B 仅内存保留当前 Agent 会话窗口，绝不落盘 /
自建向量库。**禁止卸载 / 修改 billion-context**。

### S3 服务端 HTTP（预留）

`src/server-client.ts` 在 `serverUrl` 非空时按需 `fetch`（默认 5s 超时），失败仅写
`[server]` 日志、不阻断 AI 流程；`serverUrl` 为空时零 HTTP 请求。

## 开发

```bash
pnpm install
pnpm build      # tsc -p tsconfig.json，产出 lib/index.js、lib/client.js 与 .d.ts
pnpm typecheck  # 仅类型检查
pnpm verify     # 校验 Config Schema、ctx.effect disposer、WS 网关、Agent 引擎、配置面板与 E2E 全链
```

目录结构：

```
package.json              清单（dsh.bundle.patch / dsh.client / peer / deps）
tsconfig.json             构建配置（tsc，等效 tsup）
dsh.bundle.patch.yml      Loader 补丁：插入 lumagaze 行
icon.svg                  市场图标
src/config.ts             Config Schema + volatile 读取helper + settings namespace
src/index.ts              宿主半：apply 装配 + ctx.effect 清理（Agent dispose / wss.close）
src/client.ts             浏览器半：name/inject/apply（S4 面板预留）
src/protocol.ts           第四章报文编解码与强校验
src/engine.ts             LumegazeEngine 接口 + unavailableEngine + setEngine 接缝
src/logger.ts             五类分级日志 + 敏感信息脱敏
src/switches.ts           userId 开关运行态 + 持久化回调
src/sessions.ts           会话上下文登记（多 sessionId 隔离）
src/ws-server.ts          WebSocketServer：鉴权/帧防护/路由（127.0.0.1）
src/agent-engine.ts       S3 DSH 原生 Agent 推理引擎（agent 缓存/durable 文本/降级）
src/decision.ts           S3 LLM 决策 JSON 强校验 + 兜底修复 + 出站映射
src/billion-context.ts    S3 billion-context 检测/安装/状态/记忆模式
src/server-client.ts      S3 服务端 HTTP 客户端（超时 + 日志，本期预留）
scripts/verify-config.mjs Config Schema 校验脚本
scripts/disposer-check.mjs ctx.effect disposer 生命周期校验脚本
scripts/ws-gateway-check.mjs S2 WebSocket 网关端到端校验脚本
scripts/agent-engine-check.mjs S3 Agent 引擎端到端校验脚本
scripts/client-panel-check.mjs S4 配置面板端到端校验脚本
scripts/e2e-check.mjs       T6 端到端联调（开关/拦截/降级/兜底/并发/客户端 action 提交）
docs/DELIVERY-NOTES.md      T6 交付说明（偏差表 / D8-D10 / 鉴权扩展 / 市场文案 / 未验证清单）
docs/PACKAGING-REPORT.md    T6 打包校验报告
docs/SECURITY-AUDIT.md      T6 安全审计结论
docs/E2E-REPORT.md          T6 端到端联调报告
```

## 生命周期说明（与 PLUGIN-SPEC 的差异）

- DSH/cordis **不存在** `install/enable/disable/uninstall` 四个插件生命周期钩子。
  插件生命周期只有 cordis `apply()` 加载 + `ctx.effect` 清理 + fiber
  `dispose/restart/update`。本插件在 `apply()` 内只做同步初始化，清理一律通过
  `ctx.effect` 注册（见 `src/index.ts`）。
- DSH 插件清单**没有** `permissions` 字段。能力通过 `engines.dsh`、
  `peerDependencies`（`@deepseek-ai/cordis` 等）与 `dependencies`（`ws`）声明，
  运行时能力由是否注入对应 Cordis 服务自然决定。
- 本插件**不**卸载、修改或依赖任何内部实现去操作 billion-context；其检测与自动
  安装以独立异步 effect 实现（`src/billion-context.ts`），且绝不修改其配置。

## 发布与上架校验（T6）

上架前完成打包校验、安全审计、端到端联调与偏差交付说明，结论与证据分别见：

- `docs/PACKAGING-REPORT.md` —— 清单符合 `DshPackageManifest`；发布 tarball 38 文件，
  无 `node_modules` / `scripts` / `.map`（`files` 已改为显式 glob 排除 sourcemap）。
- `docs/SECURITY-AUDIT.md` —— 仅 `127.0.0.1` 绑定、日志脱敏、无 Ollama 直连、
  无向量库落盘、billion-context 只检测不卸载（结论：通过，1 项低风险观察）。
- `docs/E2E-REPORT.md` —— 端到端 27/27 通过（开关拦截、感知包结构化回包、
  服务端失败降级、非法 LLM 兜底、双 sessionId 并发隔离）。
- `docs/DELIVERY-NOTES.md` —— D1/D2/D5 偏差表、D8/D9/D10 实测结论、
  `?token=` 鉴权扩展说明、市场上架文案与未验证清单。

本地复验：`pnpm build && pnpm verify`（`verify` 末尾会跑 `scripts/e2e-check.mjs`）。

## 版本更新说明

### 0.3.0（S3 Agent 推理 + JSON 校验 + billion 检测 + HTTP 预留）

- `src/agent-engine.ts`：`createAgentEngine(ctx, config)` 实现 `LumegazeEngine`；
  按 `sessionId` 缓存 DSH Agent，provider/model 跟随
  `agentDefaultModel.currentSelection()`，缺失降级 `MODEL_NOT_CONFIGURED`；
  文本取自 `agent.session` durable `assistant/message` 事件；`ctx.effect` 注册 dispose。
- `src/decision.ts`：LLM 决策 JSON 强校验 + 兜底修复（剥围栏 / 提取首个 `{...}` /
  补全括号），非法输出回 `INVALID_LLM_OUTPUT`，`action` 只取 12 项白名单。
- `src/billion-context.ts`：`listBundles` 检测 + 缺失时独立异步 `installBundle`，
  按 `ChangeResult.application` 分类记日志并短期降级；暴露
  `getDependencyStatus()` / `getMemoryMode()`。
- `src/server-client.ts`：`serverUrl` 非空按需 `fetch`（5s 超时），失败仅 `[server]`
  日志，不阻断 AI；空值零请求。
- `src/index.ts`：`apply()` 注入引擎并 fire-and-forget 触发 billion 安装；新增
  `scripts/agent-engine-check.mjs`（50 项断言）接入 `pnpm verify`。
- `package.json`：新增 `@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-session` peer 与
  dev 依赖。

### 0.2.0（S2 WebSocket 网关）

- `src/ws-server.ts`：`ws.WebSocketServer` 只监听 `127.0.0.1:wsPort`，握手
  `x-lumegaze-auth` 鉴权，`maxPayload` 超大帧防护，非法/空字段拒绝，服务不崩溃。
- `src/protocol.ts`：第四章入站/出站报文编解码与强校验，引擎输出兜底。
- `src/switches.ts` + `src/sessions.ts`：userId 开关隔离、多 sessionId 会话隔离。
- `toggle_walker_ai` 经 `ctx.settings.mutate` 持久化 `walkerAiSwitches`。
- `src/logger.ts`：连接/开关/推理/依赖/服务端五类分级日志，脱敏 authSecret/token。
- `src/engine.ts`：`LumegazeEngine` + `unavailableEngine` + `setEngine` 接缝。
- `ctx.effect` 清理 `wss.close()`；新增 `scripts/ws-gateway-check.mjs` 端到端校验。

### 0.1.0（S1 骨架）

- 建立 TypeScript 工程：`tsc` 构建，产出 `lib/index.js`、`lib/client.js` 与 `.d.ts`。
- `package.json` 暴露 `.` 与 `./client`，声明 `dsh.bundle.patch`、
  `dsh.client.platform="web"`、`engines.dsh`、peerDependencies 与 `ws` 依赖。
- Config Schema 落地 5 个可编辑字段 + 1 个运行态字段，全部 `volatile`。
- 宿主半 `apply()` 同步初始化并通过 `ctx.effect` 注册清理（fiber dispose 时调用）。
- 浏览器半导出 `name/inject/apply`，`inject` 预留 `slots/locale/configForms`。
- 新增 `scripts/verify-config.mjs` 与 `scripts/disposer-check.mjs` 两项可运行校验。
