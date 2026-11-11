# DSH 插件 SDK + 观灵域客户端集成参考

> 用途：供后续实现专家直接使用。覆盖任务书 A/B 两节全部 11 个要点，每条标注「已核实（文件:行号）」或「未核实」。
> 方法：全部结论来自本机只读源码核对，未做任何写操作（唯一写入是本报告文件）。
> 版本：DSH `0.2.1-rc.5`；插件目标目录 `/Users/admin/dsh-lumegaze`；规格 `/Users/admin/dsh-lumegaze/docs/PLUGIN-SPEC.md`；观灵域根 `/Users/admin/观灵域`。
> 路径前缀约定：`client/…` = `/Users/admin/观灵域/client/…`；`server/…` = `/Users/admin/观灵域/server/…`；`dsh/…` = `/Users/admin/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/…`。

---

## 0. 一句话结论（速览）

- 观灵域客户端目前**没有**「行者 AI 总开关 / `toggle_walker_ai`」概念，也没有对接任何 DSH 插件的 WS 客户端；插件要落地必须**新增客户端模块**（已核实：全库搜索无命中）。
- DSH **没有**插件「权限声明」字段，也**没有** `install/enable/disable/uninstall` 生命周期钩子；插件生命周期只有 cordis `apply()` 加载 + `ctx.effect` 清理 + fiber `dispose/restart`。
- 「调用 DSH 原生 Agent」的真实入口是 `ctx.agents.create({sessionId, agentOptions})` → `AgentHandle.agent.followup(...)` → `await agent.whenIdle()` → 从 `agent.session` 读取 `assistant/message` 事件取文本；DSH **没有**名为「Chat API」的接口。
- DSH 插件配置持久化 = Config Schema（`volatile()` 标记可编辑字段）+ profile patch（`ctx.configEditor`）+ `ctx.settings.describe/update/mutate`。
- 插件自带 WS 服务端需引入 `ws`；`ws@8.22.1` 已在 desktop/web profile 的 `node_modules` 顶层（因 `nodeLinker: hoisted`），但插件仍应显式声明 `dependencies`。

---

# A. 观灵域客户端 / 服务端集成事实

## A1. WebSocket 通道 / URL / 报文字段 / 握手鉴权 —— 已核实

### 通道与 URL

| 事实 | 证据 |
| --- | --- |
| 服务端两条通道路径为 `/agent`（行者 Agent）与 `/owner`（观者）；upgrade 时非这两个 path 直接 `socket.destroy()` | `server/src/net/WebSocketServer.ts:112`、`:130-133` |
| 客户端由基址派生：`ws://host:port` → `{owner: base+"/owner", agent: base+"/agent"}` | `client/src/net/gateway.ts:175-187`（`buildEndpoints`） |
| 默认服务端地址 `ws://127.0.0.1:8787`，默认端口 8787 | `client/src/protocol/types.ts:16-22` |
| 两条通道都用浏览器内置 `WebSocket`、JSON 文本帧 `JSON.stringify/JSON.parse` | `client/src/net/gateway.ts:216`、`:454`、`:715`、`:458-465`；`server/src/protocol/codec.ts:1-20` |

### 上行报文（客户端 → 服务端）字段名与类型

`/agent` 通道（`client/src/protocol/types.ts:170-184`，与 `server/src/protocol/messages.ts:105-119` 对齐）：

```ts
type AgentToServerMessage =
  | { type: 'hello'; role: 'agent'; walker_id: string; name: string; owner_id: string; auth_token: string }
  | { type: 'action'; tick_id: number; action: WalkerAction }
  | { type: 'ping' }
```

`/owner` 通道（`types.ts:191-214`，服务端 `messages.ts:122-145`）：

```ts
type OwnerToServerMessage =
  | { type: 'hello'; role: 'owner'; owner_id: string; auth_token: string }
  | { type: 'owner_suggestion'; walker_id: string; text: string }
  | { type: 'owner_public'; text: string }
  | { type: 'secret_collection_request'; owner_id?: string }
  | { type: 'ping' }
```

> 差异提醒：服务端 `messages.ts:136` 还定义了 `{ type: 'leaderboard_request'; board?: LeaderboardBoardName }`，但**客户端 `types.ts` 的 `OwnerToServerMessage`（`:191-214`）没有该分支**；服务端 `ServerToOwnerMessage` 有 `leaderboard`（`messages.ts:153`），客户端 `types.ts:217-228` 也**缺失** `leaderboard`。这是客户端与服务端的类型漂移，已核实。

### 下行报文（服务端 → 客户端）字段名与类型

- `/agent` 下行 `ServerToAgentMessage`：`ready` / `perception{packet}` / `action_result{ok,tick_id,action?,code?,error?}` / `error` / `pong` — `client/src/protocol/types.ts:149-163`；`server/src/protocol/messages.ts:97-102`。
- `/owner` 下行 `ServerToOwnerMessage`：`ready` / `public_message{text,from_owner_id}` / `suggestion_ack{ok,walker_id,code?}` / `secret_collection{entries}` / `error` / `pong`（客户端版） — `types.ts:217-228`。
- **感知包 `PerceptionPacket` 固定 9 字段**：`tick_id, self{name,energy,exp,rank,inventory}, vision[{id,name,distance,speech?}], area, world_event{id,type,area_id?,payload?}|null, owner_msg, current_goal, recent_events[], memory_hint[]` — `types.ts:133-143`；`server/src/protocol/messages.ts:84-94`。
- 动作白名单 12 项：`wait, move, collect, craft, give, discard, trade_propose, ally_propose, rescue, attack, place_stele, say` — `types.ts:30-43`；`messages.ts:17-30`。
- `WalkerAction = { type, target?, give?, want?, extra? }` — `types.ts:55-61`；`messages.ts:41-47`。

### 握手鉴权

- 两条通道 `hello` 必须携带 `auth_token`（共享密钥或 T22 会话 token）；缺失/错误 → `error { code:'auth_failed' }` 并主动断开 — `types.ts:178-181`、`:195-201`；`messages.ts:112-116`、`:127-131`；`server/src/net/WebSocketServer.ts:161-171`；`server/README.md:186-198`、`:325-334`。
- 密钥来源优先级：`GUANLINGYU_WS_AUTH_SECRET` → `<dataDir>/ws_auth_secret` → 启动生成 32B 随机并写文件（0600）— `server/README.md:61`、`:192-196`。
- upgrade 阶段可选携带令牌头 `x-guanlingyu-auth` / `x-auth-token` / `Authorization: Bearer`；**携带但无效 → 直接 401**；不携带则继续走 hello 阶段校验 — `WebSocketServer.ts:98`、`:116-124`、`:178-190`；`server/README.md:191`、`:333-334`。
- 恒定时间比较 `crypto.timingSafeEqual` — `WebSocketServer.ts:145-150`；`server/README.md:189`。

## A2. 客户端现有 Agent 适配器 → LLM 链路 —— 已核实（这是插件要替换/对接的链路）

### 感知包 → LLM 请求

链路入口 `client/src/agent/agentAdapter.ts`：

1. `handlePerception(packet)` 收到感知包，发布快照并触发 `recordPerceptionThenDecide` — `agentAdapter.ts:467-475`。
2. 唯一上下文入口 `buildAgentContext(...)`（来自 `src/state/isolation`）组装 prompt — `agentAdapter.ts:562-578`；`buildDecisionPrompt(context, packet)` 追加白名单/JSON Schema/可用目标 — `client/src/agent/prompt.ts:64-125`；系统提示 `AGENT_SYSTEM_PROMPT` — `prompt.ts:32-40`。
3. `this.llm.complete(AGENT_SYSTEM_PROMPT, prompt)` 调 LLM — `agentAdapter.ts:603`。
4. `parseLlmDecision(result.raw)` 校验 — `agentAdapter.ts:613`。
5. 合法 → `this.gateway.submitAction(tick_id, submittedAction)` 提交给服务端 — `agentAdapter.ts:629`。
6. 非法输出**直接丢弃**，不提交服务端；重试预算 `1 + maxRetries` — `agentAdapter.ts:546-683`、`prompt.ts:22-25` 顶部注释。

### 调用哪个 Ollama 端点

- `LlmClient` 默认 `mode:'ollama'`，`baseUrl:'http://127.0.0.1:11434'`，`model:'gemma4:12b'`，`timeoutMs:30000`，`maxRetries:1` — `client/src/agent/llmClient.ts:44-51`。
- Ollama 模式发 `POST {baseUrl}/api/chat`，body `{ model, stream:false, format:'json', messages:[{role:'system'},{role:'user'}] }` — `llmClient.ts:184-201`。
- API 模式发 `POST {baseUrl}{apiPath}`（默认 `/v1/chat/completions`），带 `Authorization: Bearer <apiKey>` — `llmClient.ts:203-236`。
- 配置来源：`LlmClientConfig { mode, baseUrl, model, apiKey, timeoutMs, maxRetries, apiPath? }` — `llmClient.ts:26-41`；由 `ClientSettings`（`client/src/storage/localStore.ts:40-137`）经 Rust 侧 `settings.json` 持久化。

### 期望的响应结构

- `extractLlmText(payload)` 依次识别：字符串本身 / `record.response`（Ollama `/api/generate`）/ `record.message.content`（Ollama `/api/chat`）/ `choices[0].message.content` 与 `choices[0].text`（OpenAI 兼容）— `llmClient.ts:115-139`。
- 空文本判为 `empty_response` 失败 — `llmClient.ts:290-297`。
- 返回类型 `LlmCallResult = {ok:true,raw:string} | {ok:false,code,reason}`，错误码 `not_configured|network_error|timeout|http_error|empty_response|bad_response` — `llmClient.ts:53-66`。

### JSON Schema 校验方式

- 纯函数 `parseLlmDecision(raw)`：剥 Markdown 代码围栏（`stripCodeFence`，只剥围栏不做括号配平/截断修补）→ `JSON.parse` → 严格对象校验 — `client/src/agent/schema.ts:82-120`。
- 校验项：`thought` 必字符串；`action` 必对象且 `action.type` 在 12 项白名单；`target/give/want/extra` 类型；`reply_owner/reply_other` 允许省略但一旦出现必须字符串 — `schema.ts:127-203`。
- 铁律：`ok:false` **必须丢弃该次决策**，不得修补后提交 — `schema.ts:22-24`。
- 校验通过后目标指令写在 `action.extra.goal`，提交前用 `stripGoalDirective` 剥离（目标栈只存客户端本地）— `agentAdapter.ts:764-771`。

### 记忆链路（客户端本地）

- `WalkerMemory` 聚合短期记忆 / 长期向量 / 目标栈 / 注意力自检 — `client/src/memory/walkerMemory.ts:74-111`。
- `recordPerception(packet)` 写短期 + 向量 + 落盘，并 `recallForPacket` 按需召回 — `walkerMemory.ts:158-203`；`vectorMemoryEnabled=false` 时不召回 — `walkerMemory.ts:192`。
- 持久化后端：Tauri 时走 `invoke('read_memory_file'/'write_memory_file'/'ensure_memory_cache_dir')` — `client/src/memory/backend.ts:66-94`；Rust 命令见 `client/src-tauri/src/lib.rs:429,449,518-526`。
- 记忆参数：`MemorySettings { shortTermMemoryLimit, longTermMemoryLimit, longTermRecallLimit, goalSwitchWindowTicks, goalSwitchMaxCount, vectorMemoryEnabled }` — `client/src/memory/types.ts:148-162`。

> 关键含义：客户端记忆、目标栈、LLM 调用、`/agent` 连接**全部在客户端进程内自持**。插件要接管，需替换 `AgentAdapter` 或与其并存。

## A3. 服务端 HTTP 接口 + ws→http 派生 —— 已核实

### HTTP 接口清单（与 WS 同端口）

路由表 — `server/src/net/httpApi.ts:72-89`：

| 方法 | 路径 | 请求体/参数 | 成功响应 | 证据 |
| --- | --- | --- | --- | --- |
| POST | `/api/register` | `{username,password}` | `201 {ok,token,expires_at,owner_id}` | `httpApi.ts:76-77,91-137`；`server/README.md:272` |
| POST | `/api/login` | `{username,password}` | `200 {ok,token,expires_at,owner_id}` | `httpApi.ts:78-79,91-137`；`README.md:273` |
| POST | `/api/logout` | `{token}` 或鉴权头 | `200 {ok,revoked:true}` | `httpApi.ts:80-81,139-157`；`README.md:274` |
| GET | `/api/me` | 鉴权头或 `?token=` | `200 {ok,username,owner_id,created_at,updated_at,last_login_at,session}` | `httpApi.ts:82-83,159-183`；`README.md:275` |
| POST | `/api/password/reset` | `{username,new_password}` | 仅占位账号可重置 | `httpApi.ts:84-85,191-236`；`README.md:363-365` |
| GET | `/healthz` | 无 | `200 {ok:true,protocol_version,tick_id}` | `WebSocketServer.ts:232-235`；`README.md:38` |

鉴权：`Authorization: Bearer <token>`、`x-auth-token: <token>`，`/api/me` 另支持 `?token=` — `httpApi.ts:292-302`；`README.md:267-268`。
错误码→状态码：`invalid_username/invalid_password`→400、`username_taken`→409、`invalid_credentials/invalid_token/session_expired`→401、`rate_limited`→429（带 `retry_after_ms`）— `httpApi.ts:41-50`；`README.md:277-280`。
限速：注册/登录/密码重置共用按 IP 滑动窗口（默认 5 分钟 10 次）— `httpApi.ts:102-112`、`:204-214`；`README.md:282-286`。
会话有效期默认 7 天 — `README.md:290-292`。

> 说明：服务端 HTTP 接口只有**账号体系** + `/healthz`，**没有**任何「拉取/同步游戏数据」的业务接口（已核实：`httpApi.ts` 全部路由仅上述 6 条）。

### 客户端由 ws 地址派生 http 基址

`deriveHttpBaseUrl(wsServerUrl)`：`wss://`→`https://`、`ws://`→`http://`，已是 `http(s)://` 原样保留，末尾 `/` 去除 — `client/src/auth/authApi.ts:144-159`。
鉴权客户端封装 `createAuthApi({baseUrl})`，`register/login/logout/me` — `authApi.ts:202-311`。

## A4. 客户端是否有「行者 AI 开关 / toggle」及期望的插件报文 —— 部分未核实（结论：不存在）

- **已核实：客户端不存在行者 AI 总开关概念。** 对 `client/src` 全库搜索 `walkerAiEnable|walker_ai|toggle_walker|行者AI|行者 AI|toggleWalker|aiEnable|AiToggle|ai_enabled` 无任何命中（本会话执行的 grep）。
- 客户端现有「开关」只有：LLM 接入模式切换（Ollama/API）、`vectorMemoryEnabled` 本地向量记忆开关（`client/src/components/AiConfigPanel.vue:162-165`；`memory/types.ts:160-161`）、`keepAliveEnabled` 连接保活开关（`net/gateway.ts:59,78`；`components/ConnectionPanel.vue:240`）。
- **已核实：客户端不存在与 PLUGIN-SPEC 第四章对应的入站/出站报文。** 客户端对外的网络面只有：`/agent`、`/owner` 两条到**游戏服务端**的 WS 通道（`gateway.ts:175-187`）与鉴权 HTTP（`authApi.ts`）。插件要接入，客户端必须新增一个指向插件的 WS 客户端模块，并新增 toggle UI —— 这部分**未核实**（源码中不存在，无法给出其「期望的报文形态」；只能以 PLUGIN-SPEC 为需求来源）。
- 客户端设置持久化：`ClientSettings`（`localStore.ts:40-137`），Tauri 下经 Rust `settings.json`（`client/src-tauri/src/lib.rs:31,342-370`），非 Tauri 降级 localStorage。

---

# B. DSH 插件 SDK 事实

## B5. 配置持久化 —— 已核实

**插件配置持久化的唯一正式机制**：插件导出 `Config` Schema（schemastery `z`）+ profile patch（profile 的 `cordis.patch.yml`）+ `ctx.settings`（`SettingsForms`）读写。

- `ctx.settings` 服务：`dsh-settings/lib/types/index.d.ts:24-29`（`Context.settings: SettingsForms`）；构造时 `static inject = ["configEditor","profileContext"]` — `dsh-settings/lib/index.js:324`。
- 写接口（全部异步、带 revision 乐观锁）：
  - `describe(options?): SettingsDescriptor[]` — `dsh-settings/lib/types/index.d.ts:96`
  - `update(ns, patch, expectedRevision?): Promise<void>`（合并可编辑字段）— `index.d.ts:102`
  - `replace(ns, section, expectedRevision?): Promise<void>`（重置可编辑字段后设置）— `index.d.ts:108`
  - `mutate(ns, ops: SettingsPathOp[], expectedRevision?): Promise<void>`（路径级 `set/unset`，适合只读到脱敏视图时写回）— `index.d.ts:114`
- 实际落盘由 `ctx.configEditor.edit(entry, change)` 完成，目标是 profile patch 文档：`dsh-config-editor/lib/types/index.d.ts:14-34`（`documentPath`、`entries()`、`configuration()`、`edit()`）；`dsh-settings/lib/index.js:502-536`。
- 冲突保护：`SettingsConflictError`（`code: "SETTINGS_CONFLICT"`）— `dsh-settings/lib/types/index.d.ts:31-44`。
- **哪些字段可在线编辑**由 Config Schema 的 `volatile()` 标记决定：`volatileForm(schema)` 递归选取「最近 volatile 祖先」字段；`write()` 对每个路径校验 `isVolatilePath`，非 volatile 字段会被拒绝/剥离 — `dsh-settings/lib/index.js:122-131,507-534`；`dsh-settings/lib/types/schema.d.ts:1-23`。
- 客户端 wire 视图（自动生成表单用）：`SettingsNamespaceView { autoGenerate, ns, schema, value, base?, user?, applies, secrets, revision }` — `dsh-settings/lib/types/types.d.ts`。
- 官方示例（读/写默认模型）：`AgentDefaultModelConfig` 用 `ownerContext.inject(["settings"], child => child.settings.configure({auto:false}, ownerContext.fiber))` + `editor.edit(entry, () => config)` 持久化 — `dsh-agent-default-model/lib/index.js:44-64`、`dsh-agent-default-model/lib/types/index.d.ts`。

**最小示例（插件视角，仅示意，非实现代码）**：

```ts
// 插件 Config（schemastery）
static Config = z.object({
  wsPort: z.number().volatile(),
  serverUrl: z.string().volatile(),
  personaPrompt: z.string().volatile(),
  logEnabled: z.boolean().volatile(),
});
// 读
const rows = ctx.settings.describe();
// 写（经 UI 或插件自身触发）
await ctx.settings.update(entryId, { wsPort: 9000 }, rows.find(r => r.ns === entryId)?.revision);
```

> 若插件要持久化「userId → walkerAiEnable」这类运行态，合理做法是作为 Config 的一个 `volatile` 字段（如 `Record<string, boolean>`）经 `ctx.settings.mutate` 写回 profile patch；DSH 未提供独立的插件私有键值存储（未核实是否有；未发现此类服务）。

## B6. 配置面板 UI —— 已核实

### 机制

- 内置「插件设置」页面由 `@deepseek-ai/dsh-client-ui-settings-plugins` 提供：浏览器半导出 `./client`，注册 `settings.section`（Plugins 页）与 `settings.plugins.tab` 列表槽 — `dsh-client-ui-settings-plugins/lib/client.js`（`PluginsSettingsSection`）；Host 半是空 `apply()` — `dsh-client-ui-settings-plugins/lib/index.js`。
- **自动生成表单**：Host 侧 `SettingsForms.describe()` 为每个有 `volatile` 字段的 entry 产出 `autoGenerate` 描述符；`configure({auto})` 可关掉自动页 — `dsh-settings/lib/index.js:370-381,413-464`。
- **自定义面板**：插件浏览器半在 `settings.plugins.tab` 或 `plugins.item` 槽注册 React 组件，并用 `ctx.configForms` 绑定自己的 namespace —— `ctx.configForms.get(ns)` 得到 `ConfigForm`（`getSnapshot/subscribe/set/unset/mutate/dispose`），`ctx.configForms.whileServed([ns], register)` 在 namespace 存在时挂载 — `dsh-client-ui-settings/lib/types/client/config-form.d.ts`（`ConfigForms` 与 `ConfigFormController`）；`ConfigForm` 契约见 `config-form-types.d.ts`。
- 最小可复用示例（已核实可编译的官方写法）——`dsh-client-ui-settings-shell/lib/client.js:158-195`：

```ts
const NS = "settings.shell";
const inject = ["slots", "locale", "configForms"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dict");
  const form = new ShellCardController(ctx.configForms.get(BASH_NS));
  ctx.effect(() => ctx.configForms.whileServed([BASH_NS, PWSH_NS], (served) =>
    ctx.slots.inject("plugins.item", () => ctx.slots.register({
      name: "plugins.item", id: "shell", order: 40,
      label: () => t("title"), locale: NS,
      inject: () => (served.has("pwsh-sandbox") ? pwsh : bash).inject(),
    }, ShellCard))), "page");
}
```

### 清单 / peerDependencies / client 配置要求

- `package.json` 需要：
  - `dsh.bundle.patch`：bundle 层补丁（相对包根）— `dsh-package-manifest/lib/types/types.d.ts:66-69`。
  - `dsh.client`：`{ platform: "web", inject?: string[], immediately?, external? }` — `types.d.ts:76-89`。
  - `peerDependencies`：`@deepseek-ai/cordis`（多数内置包为 `~4.0.5`）— 例 `dsh-client-ui-settings-plugin-inventory/package.json:42-44`。
  - 导出 `./client` 子路径：`"exports": { ".": {...}, "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" } }` — 例 `dsh-client-ui-settings-plugin-inventory/package.json:20-27`。
- 浏览器半 `apply(ctx)` 必须 `inject` `slots`、`locale`，自定义表单页再加 `configForms`；用 `ctx.locale.register(NS, {zh,en})` 提供文案 — `dsh-client-ui-settings-shell/lib/client.js:160-175`。
- 若不想写自定义 React，可只声明 Config 的 `volatile` 字段，由 `dsh-client-ui-settings` 的通用表单渲染（依赖 `autoGenerate`）——这是「最小示例」，但 PLUGIN-SPEC 第五章的状态展示/只读列表/日志开关更贴近自定义面板。

## B7. Agent 调用 —— 已核实

### 类型与签名

- `ctx.agents: AgentRegistry` — `dsh-agent/lib/types/index.d.ts:18-22`。
- `AgentRegistry.create(options: CreateAgentOptions): Promise<AgentHandle>` — `dsh-agent/lib/index.js:453-458`；`dsh-agent/lib/types/index.d.ts:278`。
- `AgentHandle = { agent: Agent; dispose(): Promise<void> }` — `types/index.d.ts:143-146`。
- `CreateAgentOptions = { sessionId: SessionId; parentAgent?; meta?: {cwd?, parentSession?, isSeeded?, origin?, delegationDepth?, agentPreset?}; inheritedEventCount?; seed?; agentOptions?: AgentOptions; signal?; setup? }` — `types/index.d.ts:48-104`。
- `AgentOptions = { provider?; model?; reasoningEffort?; maxTokens? }` — `dsh-agent/lib/types/runtime-types.d.ts:21-30`。
- Agent 运行时方法（`ReactLoopAgent`，`dsh-agent-loop/lib/index.js`）：
  - `send(message, target: 'next-turn'|'next-step', wakeup: boolean): void` — `index.js:800-805`；接口声明 `runtime-types.d.ts:186`
  - `followup(message): void`（下一独立 turn）— `index.js:806-808`；`runtime-types.d.ts:192`
  - `steer(message): void`（下一 step）— `index.js:809-811`
  - `inject(message): void`（不唤醒，下个 pre-step 消费）— `index.js:812-814`；`runtime-types.d.ts:209`
  - `cancel(cause, options?): void` — `index.js:815-821`
  - `whenIdle(): Promise<void>` — `index.js:870-875`；`runtime-types.d.ts:164`
  - `runMaintenance<T>(task): Promise<T>` — `index.js:822-845`；`runtime-types.d.ts:174`
  - `turn()`（私有驱动循环，`kick` 内部 `while (await this.turn())`）— `index.js:887-901,938+`
  - `status: 'idle' | 'running'` — `index.js:790-792`
- `createUserMessage(input)` 构造用户消息 — `dsh-llm/lib/index.js:59`。

### 准确调用序列（官方 `dsh-headless` 可编译参考）

`dsh-headless/lib/index.js:294-368` 演示了完整流程；`summarize()` 定义在 `:112-135`：

```ts
// 1) 取 provider/model（见下）
const selection = defaultModel.currentSelection();          // :303
const agentOptions = { provider: selection.provider, model: selection.model }; // :304-307

// 2) 创建 agent（挂载在调用方 fiber 生命周期下）
const sessionId = `session-${randomUUID()}`;
const handle = await ctx.agents.create({ sessionId, meta: { cwd }, agentOptions, setup }); // :317-322
const agent = handle.agent;

// 3) 喂入一轮对话
agent.followup(createUserMessage({
  content: [{ type: "text", text: task }],
  source: { kind: "user" },
}));                                                                          // :340-346

// 4) 等待完成（子 agent 场景用循环 + whenIdle）
while (true) {
  await agent.whenIdle();                              // :349
  const idleSeq = agent.session.seq;
  if (!await subagents?.waitForChildren(agent) && agent.status === "idle" && agent.session.seq === idleSeq) break;
}

// 5) 取回最终助手文本：遍历 session 的 durable 事件
const firstSeq = agent.session.seq;                    // :325
for (let seq = firstSeq; seq < agent.session.seq; seq++) {   // summarize :117-130
  const event = agent.session.eventAt(SessionSeq(seq));
  if (event.type === "assistant/message") {
    text = event.data.message.content
      .filter(b => b.type === "text").map(b => b.text).join("");
  }
}
// 最后 handle.dispose() 释放
```

- 事件类型 `assistant/message` 属于 `dsh-session` 的 `SessionEventMap` — `dsh-session/lib/types/types.d.ts:331`；`session.eventAt(SessionSeq(seq))` / `session.seq` 为读取接口。
- 响应文本的**权威来源是 session 日志**，不是内存累加。

### provider / model 从哪里来

- 插件创建 agent 时若**不指定** `agentOptions`，使用该 Agent 配置/默认值；`dsh-agent-loop` 的 `Config.agents` 数组每项带 `id/sessionId?/cwd?/resumeSessionId?` 与 `AgentOptions`（含 `provider/model`）— `dsh-agent-loop/lib/types/index.d.ts:80-97`。
- 推荐由 `ctx.agentDefaultModel`（服务名 `agentDefaultModel`）读取：`currentSelection(): ModelSelection { provider, model, reasoningEffort? }` — `dsh-agent-default-model/lib/index.js:44-51`；`dsh-agent-default-model/lib/types/index.d.ts`（`Context.agentDefaultModel`）。profile 中该值由 patch 配置，例如 desktop profile `cordis.patch.yml:37-41` 配置 `provider: loomy`、`model: spark-x2.6`。
- provider 适配器（如 Ollama）在 `llm-pi-ai` 的 `providers` 配置里注册（desktop profile `cordis.patch.yml:23-35` 注册 `ollama`，`baseURL: http://127.0.0.1:11434/v1/`）。
- 模型选择 UI 相关：`dsh-client-ui-settings-models`、`dsh-client-ui-model-selection`（存在，未深入核对其运行时 API）。

### 如何避免阻塞主流程

- `followup()` 是**非阻塞**入队；`whenIdle()` 才是等待点 — `dsh-agent-loop/lib/index.js:806-808,870-875`。插件应在自己的 async 任务里 `await whenIdle()`，或用 `ctx.agents.withoutInitiator(...)` 建立无 initiator 边界 — `dsh-agent/lib/index.js:414-416`。
- `cancel({kind:'user'})` / `cancel({kind:'disposed'})` 可中止；`ctx.effect` 中注册的 handle 会在 fiber 卸载时被 `dispose()` — `dsh-agent-loop/lib/index.js:1948`；`dsh-agent/lib/types/index.d.ts:143-146`。
- DSH **没有**「同步 chat」阻塞 API（已核实：不存在 `chat()` 之类接口）。

## B8. WebSocket —— 已核实

- DSH **没有**面向插件的通用 WS 服务端能力（不存在 `ctx.ws` / `ctx.websocketServer` 之类的 Cordis 服务；已核实：grep 未发现）。`dsh-api-gateway` 内部使用 `ws` 实现 `RemoteStreamMuxServer`（`new WebSocketServer({noServer:true})` + `handleUpgrade`），但它是 API 网关专用，不是通用插件服务 — `dsh-api-gateway/lib/types/stream-server.js:4,13,38-39`。
- `ws` 作为依赖**可以被插件引入**：`dsh-api-gateway/package.json:62` 声明 `"ws": "^8.21.3"`。
- 本机 profile 中 `ws` 已存在：`/Users/admin/.dsh/profiles/desktop/node_modules/ws/package.json` → `version: 8.22.1`；web profile 同样存在。desktop profile 的 `pnpm-workspace.yaml` 设置 `nodeLinker: hoisted`，因此传递依赖被提升到顶层 `node_modules/ws`（**即使它不是 profile 的直接 dependency**）。
- 插件进程（Electron/Node 主进程）创建 WS 服务器的标准做法：`import { WebSocketServer } from 'ws'` → `new WebSocketServer({ host: '127.0.0.1', port })`，并在 `ctx.effect` 清理里 `wss.close()`（与 `GameWebSocketServer.close()` 一致 — `server/src/net/WebSocketServer.ts:225-230`）。
- **建议**：插件应在 `package.json` 的 `dependencies` 里显式声明 `ws`（以及 `@types/ws` 开发依赖），不能依赖传递依赖的提升；profile 安装时用 `ctx.pluginManager.installBundle` 走 pnpm 会把依赖写入 profile（见 B11）。

## B9. 生命周期 —— 已核实（无 install/enable/disable/uninstall 钩子）

- cordis 插件生命周期只有：
  - **加载**：`ctx.plugin()` 构造 `Fiber`，执行插件 `apply(ctx, config)`（或对类式插件 `new callback(ctx, config)` 后调用 `init()`）— `cordis/lib/index.js:1063-1072`。
  - **卸载/清理**：`Fiber._unload()` 依次执行所有 `ctx.effect` 收集的 disposer — `cordis/lib/index.js:1372-1392`；`dispose()` 会 `emitPluginDisposed` 并触发 `_unload` — `cordis/lib/index.js:1075-1091`。
  - **重载**：`Fiber._reload()` / `restart()` / `update(config)`（`internal/update` waterfall）— `cordis/lib/index.js:1349-1371,1410-1442`。
  - **状态事件**：`internal/status` 在状态迁移时发出 — `cordis/lib/index.js:349-351,1330-1343`。
  - **类式插件 init 钩子**：`instance[symbols.initHooks]` 逐个调用、再 `instance[symbols.init]?.()` — `cordis/lib/index.js:1066-1070`；符号 `init` 定义于 `cordis/lib/types/utils.d.ts:25,31`。
- **已核实：DSH/cordis 不存在 `install`/`enable`/`disable`/`uninstall` 这四个插件生命周期钩子**（`cordis`、`cordis-plugin-loader`、`dsh-plugin-manager` 源码中均无对应 hook 名）。
- 插件的「启用/禁用」是**管理操作**，不是插件内钩子：`ctx.pluginManager.setPluginEnabled(id, enabled)` / `setBundleEnabled(name, enabled)` 持久化 desired 状态并在线应用 — `dsh-plugin-manager/lib/types/index.d.ts:105,111`。
- 因此 PLUGIN-SPEC 七.8「实现完整生命周期钩子 install/enable/disable/uninstall」在真实 SDK 中**没有对应物**；正确实现是：`apply()` 内做初始化 + `ctx.effect` 注册清理（`wss.close()`、`handle.dispose()`、`disposer` 等）。

## B10. 权限声明 —— 已核实（不存在该字段）

- DSH 插件清单 `DshPackageManifest` 的字段只有：`name, version, description?, icon?, private?, dependencies?, peerDependencies?, engines?, dsh?`；`dsh.dsh` 下只有 `manifestVersion?, bundle?, profile?, client?` — `dsh-package-manifest/lib/types/types.d.ts:7-90`。
- `engines` 只有 `dsh?/node?/npm?` 及任意扩展键 — `types.d.ts:54-64`。
- **已核实：`dsh-package-manifest`、`dsh-plugin-manager`、`dshmarket` 中均不存在插件级 `permissions` / `capabilities` / `scope` 清单字段**。`dsh-plugin-manager` 里出现的 `permission` 只是安装失败分类（`PluginInstallFailureKind`）或 sandbox 权限提示，不是清单字段 — `dsh-plugin-manager/lib/types/types.d.ts:100`；`dsh-plugin-manager/lib/types/tools.js:30,76`。`dshmarket` 的兼容/展示依据是 `engines.dsh` 与 `@deepseek-ai/dsh-*` peer 版本 — `dshmarket/README.zh.md:61`。
- 因此 PLUGIN-SPEC 八.2「权限仅申请最小集合（Agent 调用、插件管理 API、本地配置存储、本地 WebSocket、HTTP 请求）」**没有声明载体**；现实替代是：
  - `engines.dsh`（声明 DSH 版本兼容）；
  - `peerDependencies`（声明 `@deepseek-ai/dsh-agent` / `dsh-plugin-manager` / `dsh-settings` / `dsh-client-ui-settings` 等同版本线依赖）；
  - `dependencies`（声明 `ws` 等运行时依赖）；
  - 运行时能力由「是否注入对应 Cordis 服务」自然决定（无声明即无权限，DSH 不会因清单字段授予额外能力）。

## B11. 插件市场安装 —— 已核实

### `installBundle` 签名与返回

```ts
// dsh-plugin-manager/lib/types/index.d.ts:123
installBundle(spec: string, options?: InstallBundleOptions): Promise<ChangeResult>
```

- `InstallBundleOptions = { enabled?: boolean; saveExact?: boolean; requestId?; approvedBuilds?: string[]; registry?: Registry }` — `dsh-plugin-manager/lib/types/types.d.ts:147-157`。
- `ChangeResult = { changed; application: 'applied'|'restart-required'|'overridden'|'failed'|'cancelled'; restartReason?; stage: 'install'|'enable'|'remove'; target; enabled?; error?: ManagementError; warnings?; packageResult?; bundle?; version?; pendingBuilds?; approvedBuilds?; registries?; failedAt? }` — `types.d.ts:115-144`。
- `ManagementError.code` 含 `unknown-plugin|invalid-spec|already-installed|ambiguous-install|not-bundle|not-removable|stop-profile|bundle-in-use|stale-approval|incompatible-version|operation-error|...` — `types.d.ts:18-23`。
- 兼容检查会拦截 `engines.dsh` / DSH peer 不满足的包（`incompatible`）— `types.d.ts:9-16`。
- `ctx.pluginManager.listPlugins(): Promise<PluginInfo[]>` 与 `listBundles(): Promise<BundleInfo[]>` 用于检测已装/已启用 — `dsh-plugin-manager/lib/types/index.d.ts:82-88`；`BundleInfo` 含 `name, installed, enabled, optional, removable, error?` — `types.d.ts:51-89`。
- 第三方市场 `dshmarket` 也是调用 `manager.installBundle(spec, options)` — `dshmarket/lib/official-desktop.js:319`、`:436`。

### 在插件 enable 阶段检测并安装 billion-context

- **检测**：`await ctx.pluginManager.listBundles()` 后按 `name === 'billion-context'`（且 `installed` / `enabled`）判断，或 `listPlugins()` 查找其 patch 行 `bili-native` / `bili-compaction-gate` — 依据 `types.d.ts:51-89`。
- **已安装事实**：desktop profile `package.json:8` 声明 `"billion-context": "^0.1.212"`，并在 `dsh.profile.bundles` 中列出；`/Users/admin/.dsh/profiles/desktop/node_modules/billion-context` 存在（version `0.1.212`）。其 bundle 补丁插入 `bili-native` 与 `bili-compaction-gate` 两个 Loader 行，并把 `compaction-basic` 置 `auto:false`、给 4 个 preset 注入 `biliBasicCompactionPolicy` — `billion-context/dsh.bundle.patch.yml:21-55`。web profile 同样在 bundles 列表（`web/package.json`）。
- **安装路径**：不存在时 `await ctx.pluginManager.installBundle('billion-context', { enabled: true, requestId })`；`installBundle` 内部走 pnpm（GitHub 地址先做连接检查），失败/取消会恢复 `package.json` 与 `pnpm-lock.yaml`，下载文件可能残留 — `dsh-plugin-manager/lib/types/index.d.ts:112-123`。
- **失败处理**（PLUGIN-SPEC 三.2.4 要求「写警告、继续运行、进入降级」）：检查 `ChangeResult.application`：`'applied'` → 已启用；`'restart-required'` → 需重启，当前进程不生效，记警告；`'failed'` / `'cancelled'` / `'overridden'` → 记 `error`/`warnings` 并进入降级（短期上下文模式）。
- **重要风险（未核实的部分）**：在插件自身 `apply()` 内同步调用 `installBundle` 会触发 profile 发布/`reload`（`publishAndReload`/`reload` — `dsh-plugin-manager/lib/types/index.d.ts:158-170`），可能导致**正在运行的本插件被卸载重载**，甚至触发 `restart-required`。因此建议：把检测安装放到独立 effect/异步任务并捕获异常，或在启动早期（profile 组合完成后）执行，避免在 `apply()` 同步体里 await 安装。此「插件内调用 installBundle 的副作用边界」**未核实**（需实测确认）。

---

# C. PLUGIN-SPEC 与真实 DSH / 客户端协议的差异

| # | PLUGIN-SPEC 说法 | 真实事实 | 证据 |
| --- | --- | --- | --- |
| D1 | 第七章「实现完整生命周期钩子 install/enable/disable/uninstall」 | 无此四钩子；只有 cordis `apply()` 加载 + `ctx.effect` 清理 + fiber `dispose/restart/update` | `cordis/lib/index.js:1063-1091,1372-1392,1410-1442` |
| D2 | 第八章「清单包含权限声明」 | 清单无 `permissions/capabilities/scope` 字段 | `dsh-package-manifest/lib/types/types.d.ts:7-90` |
| D3 | 第四章「客户端→插件」报文 `{sessionId,userId,type:chat\|game_tick\|toggle_walker_ai,content,timestamp}` | 客户端不存在该报文；客户端只有 `/agent`、`/owner` 两条到**游戏服务端**的 WS 通道 | `client/src/net/gateway.ts:175-187` |
| D4 | 第四章「插件→客户端」报文 `{sessionId,userId,text,emotion,action[],success,errorCode,errorMsg}` | 客户端无任何对应出站期望；`emotion/action/success/errorCode` 字段在客户端协议中不存在 | `client/src/protocol/types.ts` 全文件 |
| D5 | 第二章「调用 DSH 原生 Agent Chat 接口」 | 真实入口 `ctx.agents.create` → `AgentHandle.agent.followup/whenIdle`，无「Chat API」 | `dsh-agent/lib/index.js:453-458`；`dsh-agent-loop/lib/index.js:800-875` |
| D6 | 第二章「插件提供本地 WebSocket 接口，供观灵域客户端连接」 | 客户端当前**没有**连接插件的 WS 客户端模块（需新增） | 已核实：`client/src` 无插件 WS 客户端 |
| D7 | 第二章「基于 userId 的登录隔离 + 行者 AI 总开关控制」 | 客户端无 toggle 概念；`userId` 在客户端侧映射为 `owner_id`（登录账号） | 全库 grep 无 `walkerAiEnable`；`localStore.ts:40-137` |
| D8 | 第三章「调用 DSH 插件市场 API 安装 billion-context」 | 真实 API 是 `ctx.pluginManager.installBundle(spec, options)`；不存在名为「市场 API」的独立安装接口 | `dsh-plugin-manager/lib/types/index.d.ts:123` |
| D9 | 第二章「服务端请求失败仅打日志，不中断 AI 流程」 | 可行，但服务端目前**只有账号 HTTP 接口 + `/healthz`**，没有「游戏业务数据」接口可拉取 | `server/src/net/httpApi.ts:72-89`；`WebSocketServer.ts:232-235` |
| D10 | 第三章「记忆能力全部交由 billion-context」 | billion-context 是一个 bundle（插入 `bili-native`/`bili-compaction-gate`），未核实其是否对外暴露可被本插件直接调用的记忆 API；其作用主要通过 agent preset 注入 | `billion-context/dsh.bundle.patch.yml:21-40`（API 未核实） |
| D11 | 第七章「禁止监听 0.0.0.0，仅 127.0.0.1」 | 符合 Node/ws 实践，可实现；DSH 无额外限制 | `server/src/net/WebSocketServer.ts:225-230`（同类关闭示例） |

# D. 实现前必须由用户裁决的开放问题

1. **「AI 大脑」放在哪一侧？** 现状是客户端 `AgentAdapter` 持有 `/agent` 连接并直接调 Ollama。若插件接管，客户端是否改为只做协议转发？`/agent` 是单 walker 覆盖式注册（`agentAdapter.ts:16-20` 注释），插件/客户端**不能同时**连服务端 `/agent`。需裁决：客户端继续持有 `/agent` 并把感知包转发给插件，还是插件直接连 `/agent`。
2. **插件的 WS 协议最终形态**：PLUGIN-SPEC 第四章字段与客户端现状完全不一致（D3/D4）。客户端需新增模块与 UI，需用户确认报文字段与错误码（`WALKER_AI_DISABLED` 等）是否保留。
3. **userId 认证与隔离**：插件 WS 是否需要鉴权？PLUGIN-SPEC 未定义；本地回环下的信任边界需裁决（能否信任客户端上报的 `userId`）。
4. **provider/model 选择**：插件应读 `ctx.agentDefaultModel.currentSelection()`（可由用户在模型设置页切换），还是固定配置某 provider/model？是否需要支持 Ollama 本地（经 `llm-pi-ai` 的 `ollama` provider）？需裁决。
5. **服务端业务交互**：PLUGIN-SPEC 二.6/六.4 说「向游戏服务端拉取/同步游戏数据」，但服务端无对应接口。需裁决：扩展服务端接口，还是本期不做。
6. **billion-context 集成深度**：是仅「检测已安装并依赖其自动生效」（推荐、需确认其是否自动 hook 到 agent），还是主动调用其记忆 API（其 API 未核实）。
7. **插件内调用 `installBundle` 的安全性**：在 `apply()` 内 await 安装可能触发本插件重载/`restart-required`（D8 风险项）。需裁决安装时机与降级策略。
8. **配置持久化的范围**：`userId→开关` 运行态是否写入 Config（profile patch）？还是另存插件私有文件？DSH 无插件私有 KV 服务（未核实到）。
9. **客户端感知来源**：若插件不再直连 `/agent`，`PerceptionPacket` 由谁组装、如何经插件→Agent（注意 SPEC 铁律：公屏不得进入感知包）。

---

# E. 附录

## E1. 证据文件索引（相对根）

- 规格：`/Users/admin/dsh-lumegaze/docs/PLUGIN-SPEC.md`
- 客户端协议/网关/Agent/LLM/Schema/Prompt/记忆/设置：`client/src/protocol/types.ts`、`client/src/net/gateway.ts`、`client/src/agent/{agentAdapter,llmClient,schema,prompt}.ts`、`client/src/memory/*.ts`、`client/src/storage/localStore.ts`、`client/src/auth/authApi.ts`、`client/src-tauri/src/lib.rs`
- 服务端协议/HTTP/WS：`server/src/protocol/{messages,codec,channels}.ts`、`server/src/net/{httpApi,WebSocketServer}.ts`、`server/README.md`
- DSH SDK：`dsh/dsh-agent/lib/index.js`、`dsh/dsh-agent/lib/types/{index,types,runtime-types}.d.ts`、`dsh/dsh-agent-loop/lib/index.js`、`dsh/dsh-agent-loop/lib/types/index.d.ts`、`dsh/dsh-settings/lib/index.js`、`dsh/dsh-settings/lib/types/{index,types,schema}.d.ts`、`dsh/dsh-config-editor/lib/types/index.d.ts`、`dsh/dsh-client-ui-settings/lib/types/client/{config-form,config-form-types}.d.ts`、`dsh/dsh-client-ui-settings-plugins/lib/{index,client}.js`、`dsh/dsh-client-ui-settings-shell/lib/client.js`、`dsh/dsh-client-ui-settings-plugin-inventory/lib/client.js`、`dsh/dsh-package-manifest/lib/types/types.d.ts`、`dsh/dsh-plugin-manager/lib/types/{index,types}.d.ts`、`dsh/dsh-agent-default-model/lib/{index.js,types/index.d.ts}`、`dsh/dsh-headless/lib/index.js`、`dsh/dsh-llm/lib/index.js`、`dsh/cordis/lib/index.js`、`dsh/cordis/lib/types/utils.d.ts`、`dsh/dsh-api-gateway/lib/types/stream-server.js`、`dsh/dsh-api-gateway/package.json`
- profile：`/Users/admin/.dsh/profiles/desktop/{package.json,cordis.patch.yml,pnpm-workspace.yaml,node_modules/ws/package.json,node_modules/billion-context/dsh.bundle.patch.yml}`、`/Users/admin/.dsh/profiles/web/package.json`
- 第三方市场：`/Users/admin/.dsh/profiles/desktop/node_modules/dshmarket/{README.zh.md,lib/official-desktop.js}`

## E2. 未核实清单（明确标注）

- 客户端「期望从插件收到的报文形态」——源码中不存在，无法核实；仅能以 PLUGIN-SPEC 第四章为需求来源。
- `billion-context` 对外暴露的**记忆 API**（是否提供可被第三方插件直接调用的 ctx 服务）——本次只核实到它是 bundle 与两个 Loader 行，未核实其 runtime service 面。
- 插件在自身 `apply()` 内调用 `ctx.pluginManager.installBundle` 的**副作用边界**（是否会卸载重载自身、`restart-required` 的具体触发条件）——需实测。
- DSH 是否提供插件私有键值存储服务——未核实到（搜索 `ctx.settings`/`ctx.storage` 等未发现插件私有 KV；`dsh-storage` 面向会话/作业，未深入核对其是否可被插件用作配置）。
- `dsh-client-ui-settings-models` / `dsh-client-ui-model-selection` 的运行时模型选择 API 细节——未深入核对。

## E3. 最小清单骨架（仅示意，非实现代码）

```jsonc
// package.json
{
  "name": "dsh-lumegaze",
  "version": "0.1.0",
  "description": "观灵域行者 AI 网关（配套观灵域 Tauri 客户端）",
  "engines": { "dsh": ">=0.2.1-rc.5" },
  "peerDependencies": { "@deepseek-ai/cordis": "~4.0.5" },
  "dependencies": { "ws": "^8.18.0" },
  "dsh": {
    "bundle": { "patch": "./dsh.bundle.patch.yml" },
    "client": { "platform": "web", "inject": ["slots", "locale", "configForms"] }
  },
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" }
  }
}
```

```ts
// 插件（lib/index.js，示意）
export const name = 'dsh-lumegaze';
export const inject = ['agents', 'pluginManager', 'settings'];
export const Config = z.object({
  wsPort: z.number().volatile(),
  serverUrl: z.string().volatile(),
  personaPrompt: z.string().volatile(),
  logEnabled: z.boolean().volatile(),
});
export function apply(ctx, config) {
  const disposers = [];
  // 1) 检测/安装 billion-context（异步 + 失败降级）
  // 2) 创建 WS 服务器（ws，host 127.0.0.1）
  // 3) ctx.effect 注册清理：wss.close()、agent handle.dispose()
}
```

---

*报告结束。所有结论均基于上述源码/文件的只读核对；未核实项已在 E2 明确列出。*
