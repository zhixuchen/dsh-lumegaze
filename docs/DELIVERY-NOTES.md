# dsh-lumegaze 交付说明（T6 · T13 · T15 回写 M1–M4 修复 + T14 S-M1-2/S-3/S-4）

> 版本：0.1.0 · 交付角色：运维工程师（打包 / 审计 / E2E / 交付说明）
> 实现范围：S1–S5 + T7 + T9 + T10 + T11 + T12 + T14（T8 三轮评审最终 pass）
> 本文初稿由 T6 在评审修复**之前**写成；T13 按 T11/T12 修复后的**当前代码**逐条核实并回写；
> T15 按 T14（S-M1-2 宿主级启停 + S-3/S-4 健壮性）后的**当前代码**逐条核实并回写。

本文档是上架前交付说明，含偏差表、M1–M4 修复说明、T14 宿主级启停与 S-3/S-4 健壮性说明、新错误码、实测结论、鉴权扩展说明、市场文案与未验证清单。
配套证据：`docs/PACKAGING-REPORT.md`（打包校验）、`docs/SECURITY-AUDIT.md`（安全审计）、
`docs/E2E-REPORT.md`（端到端联调）。

---

## 1. 交付概览

| 交付项 | 结论 | 证据 |
| --- | --- | --- |
| 打包校验 | 通过（38 文件；无 node_modules / scripts / .map 泄漏） | `docs/PACKAGING-REPORT.md` |
| 安全审计 | 通过（1 项低风险观察：`?token=` 走 URL query） | `docs/SECURITY-AUDIT.md` |
| E2E 联调 | 27/27 通过（5 类场景全覆盖） | `docs/E2E-REPORT.md`、`scripts/e2e-check.mjs` |
| M1–M4 / T14 修复回归 | 通过（ws-gateway 验收、agent-engine 92/0、client-panel 71/0、e2e 27/0） | `scripts/ws-gateway-check.mjs`、`scripts/agent-engine-check.mjs`、`scripts/client-panel-check.mjs`、本文 §3–§4 |
| 客户端半构建格式（T10） | `lib/client.js` 改为 CJS-factory（`window.__ModuleLoader__.load({ id, factory })`），可被 DSH 客户端模块系统消费 | `tsdown.config.ts`、`lib/client.js`、本文 §3.5 |
| 偏差交付说明 | 见本文第 2–8 节 | 本文 |

构建与既有校验链：`pnpm build` 退出 0（`tsc` 宿主半 + `tsdown` 客户端半）；`pnpm verify` 退出 0（verify 已纳入 6 个脚本）。

> 计数口径：`pnpm verify` 链当前逐脚本结果为 `verify-config` PASSED（6 volatile 字段）、`disposer-check` PASSED（3 effects）、
> `ws-gateway-check` PASSED（S2 验收 + S-4 关闭窗口竞态）、`agent-engine-check` 92 passed / 0 failed、`client-panel-check` 71 passed / 0 failed、
> `e2e-check` 27 passed / 0 failed。
> 注：`client-panel-check` 的 71 项含 T14 新增的 S-M1-2 宿主级启停 14 项（§3.7）。
> 注：`docs/E2E-REPORT.md` §4 的 per-script 计数为 M1–M4 修复**之前**的值（agent-engine 64、client-panel 38、2 effects），
> 以本文本节当前值为准；`docs/E2E-REPORT.md` 不在本任务修改范围内。

---

## 2. 已裁决偏差表（D1 / D2 / D5 / S-M1-2）

| # | 规格说法（PLUGIN-SPEC） | 真实实现（本插件） | 证据 |
| --- | --- | --- | --- |
| D1 | 第七章 8「实现完整生命周期钩子 install / enable / disable / uninstall」 | DSH/cordis **不存在**这四个钩子；插件用 `apply(ctx, config)` 做同步初始化 + `ctx.effect` 注册清理（`wss.close()`、Agent dispose、开关/会话清理）。插件启用/禁用由 DSH 插件管理器（`setPluginEnabled`/`setBundleEnabled`）负责，不是插件内钩子 | SDK 文档 B9（`cordis/lib/index.js:1063-1091,1372-1392`）；`src/index.ts:202-299`（`apply` / `ctx.effect`）、`src/engine.ts:42-92`（disposer 契约） |
| D2 | 第八章 2「清单包含权限声明（permissions / capabilities / scope）」 | DshPackageManifest **无** `permissions` 字段；用 `engines.dsh`（版本兼容）+ `peerDependencies`（同版本线 dsh-* 依赖）+ `dependencies`（运行时依赖 `ws`）替代声明，运行时能力由是否注入 Cordis 服务自然决定（无声明即无权限） | `node_modules/@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts:7-30`（字段表，仅 name/version/description/icon/private/dependencies/peerDependencies/engines/dsh）；SDK 文档 B10；`package.json` |
| D5 | 第二章 6「调用 DSH 原生 Agent Chat 接口」 | 真实入口为 `ctx.agents.create({sessionId, agentOptions:{provider,model}})` → `handle.agent.followup(...)` + `agent.whenIdle()`；provider/model 跟随 `ctx.agentDefaultModel.currentSelection()`，缺失回 `MODEL_NOT_CONFIGURED`；回复文本取自 `agent.session` 的 durable `assistant/message` 事件 | `src/agent-engine.ts:191-356`（`createAgentEngine` / `chat` / `runChat`）；SDK 文档 D5（`dsh-agent/lib/index.js:453-458`） |
| S-M1-2 | 第五章 1「插件总开关：启用 / 禁用整个插件」 | 面板「插件总开关」是**双级控制**（T14 已补齐宿主级）：(a) 插件内 WS 功能开关（`enabled`）：`false` 时 `apply()` 不启动 WS 网关，运行期翻转由 `loader/volatile-update` 事件驱动启停，网关运行期对 `chat`/`game_tick` 回 `PLUGIN_DISABLED`；(b) **宿主级启停**：开关开启即经浏览器半 `ctx.remote.pluginManager`（`TypertRemoteService` 远程命名空间）调 `setPluginEnabled('lumegaze', true)` 启用整个插件，关闭先弹确认再调 `setPluginEnabled('lumegaze', false)`（宿主级禁用会卸载本插件，面板随之消失，可从 DSH 插件管理器重新启用）。remote 未注入 / 返回 `{ok:false}` / 抛错三路失败均记日志返回 `false`、不崩溃，插件内 `enabled` 草稿继续作运行期 WS 网关兜底。双级互不替代 | `src/client/lumegaze-card-controller.ts:64-76,174-207,218-231`、`src/client/LumegazeCard.tsx:123-163`、`src/client.ts:16-32,42-50`、`src/index.ts:231-260`、`src/ws-server.ts:229-241`、`src/config.ts:19-28`、`src/client/locales.ts:60-63` |

> S-M1-2 已按裁决补齐宿主级调用：面板「插件总开关」现在同时具备「宿主级 `setPluginEnabled` 启用/卸载整个插件」与「插件内 `enabled` 运行期 WS 网关开关」两级，替代此前「仅插件内 WS 开关」的偏差状态。

补充偏差（规格与真实 SDK 的差异，非本插件自行发明）：

| # | 规格说法 | 真实事实 | 本插件处理 |
| --- | --- | --- | --- |
| D8 | 第三章「调用 DSH 插件市场 API 安装 billion-context」 | 真实 API 是 `ctx.pluginManager.installBundle(spec, options)`；不存在名为「市场 API」的独立接口 | 见第 5 节 |
| D9 | 第二章 6「向游戏服务端拉取 / 同步游戏数据」 | 服务端目前只有账号 HTTP 接口 + `/healthz`，无「游戏业务数据」接口 | 见第 5 节 |
| D10 | 第三章「记忆能力全部交由 billion-context」 | billion-context 是 bundle，仅插入 `bili-native` / `bili-compaction-gate` 两个 Loader 行；**未核实**是否对外暴露可被第三方插件直接调用的记忆 API | 见第 5 节 |

---

## 3. M1–M4 修复说明（T11 / T12 回写）

### 3.1 M1 —— `enabled` 开关实际生效（运行期启停 WS 网关）

- `src/index.ts:231-240`：`apply()` 的 `ctx.effect` 内，仅当 `readVolatile(config.enabled) === true` 才 `gateway.start(port)`，否则记 `dependency` 日志且不启动。
- `src/index.ts:186-191` `onLoaderVolatileUpdate` 注册 `loader/volatile-update` 监听；`src/index.ts:244-259` 只处理 `enabled` 路径：
  `false→true` 且 `!gateway.isRunning()` → `gateway.start(wsPort)`；`true→false` 时**无条件** `void gateway.stop()`
  （S-4：即使处于关闭窗口、`isRunning()` 为 false 也请求 stop，以取消延迟补启）；其他 volatile 字段变化不触发网关启停。
- `src/ws-server.ts:291-301`：网关运行后**帧级**拦截——`message.type !== 'toggle_walker_ai'` 且 `isEnabled?.() === false` 时不调用引擎，直接回
  `PLUGIN_DISABLED`；`toggle_walker_ai` 仍允许执行（改的是用户开关，不是插件总开关）。
- 出站回包：`src/ws-server.ts:296-299` 回 `errorOutbound(sessionId, userId, 'PLUGIN_DISABLED', '插件已禁用，请先在配置面板开启插件总开关')`。
- 语义边界（S-M1-2）：`enabled` 是插件内 WS 功能开关（本节约束的启停路径）；宿主级整个插件的启用/卸载另经面板「插件总开关」调 `setPluginEnabled` 完成（见 §2 偏差表与 §3.7）。双级互不替代。
- 实测：`scripts/ws-gateway-check.mjs`「M1 插件总开关」两节——`enabled=false` 不启动网关且帧级拦截回 `PLUGIN_DISABLED`、引擎零调用；
  运行期 `false→true` 端口监听、`true→false` 停止监听、非 `enabled` 路径不触发启停。

### 3.2 M2 —— 超长 JSON 动作整项丢弃，不再截断成坏 JSON

- `src/protocol.ts:166-179` `isJsonActionObject` 只判「以 `{` 开头且可 `JSON.parse` 为非数组对象」，**移除长度预筛**（注释说明：长度闸门属于「保留还是丢弃」的决策，放在调用分支内，否则超长合法 JSON 会先被判 false 而落入裸类型分支被截断成坏 JSON）。
- `src/protocol.ts:195-218` `sanitizeActions`：完整 JSON 动作对象长度 ≤ `MAX_JSON_ACTION_LENGTH`（2048，`src/protocol.ts:85`）原样保留；
  超限整项**丢弃**并回调 `onDrop('json_action_too_large')`；以 `{` 开头但解析失败整项丢弃（回调 `malformed_json_action`）；
  裸动作类型字符串仍按 `MAX_ACTION_LENGTH`（128，`src/protocol.ts:79,214`）兜底截断；任意分支最多保留 `MAX_ACTIONS`（16）项。
- 丢弃策略（评审建议项 S-M2-1 的裁决）：**仅当全部动作被丢弃**才把出站降级为失败 + `ACTION_TOO_LARGE`；
  部分丢弃仍保留 `success: true`，丢弃项只记日志（见 §4.2）。
- 丢弃诊断只记长度与原因，不落原文（`src/ws-server.ts:369-377`、`src/agent-engine.ts:307-310`）。
- 实测：`scripts/agent-engine-check.mjs` 的 S-M2-1 区段——超限动作整项丢弃不产坏 JSON、客户端解析视角要么完整要么明确无候选、
  裸类型仍 128 截断、全部丢弃回 `success:false`/`ACTION_TOO_LARGE`、部分丢弃保留 `success:true`、空动作不触发失败。

### 3.3 M3 —— 面板新增「插件鉴权密钥」（write-only）

- `src/client/LumegazeCard.tsx:166-175`：新增 `SettingsSecretField`（label「插件鉴权密钥」，id `plugin-config-lumegaze-auth-secret`），
  绑定 `state.authSecret` 与 `state.authSecretConfigured`，文案见 `src/client/locales.ts:64-66`。
- `src/client/lumegaze-card-controller.ts:112-120`：`settingsAuthSecretSpec` 为 **write-only secret**——草稿永远从空白开始、**绝不回显已存明文**；
  保存经 `scope.mutate([{ op: 'set', path: ['authSecret'], value: text }], revision)` 原子写，并带快照 revision 栅栏；空白草稿不写（保留既有密钥）。
- 绑定 volatile 字段 `authSecret`（`src/config.ts:35-36`）；插件 WS 握手每次读取该值（`src/ws-server.ts:129`），保存后即时生效。
- 面板字段数：规格第五章 7 项 + 本项 = 8 项；鉴权密钥为规格外扩展（规格未定义 WS 鉴权，见 §6）。
- 实测：`scripts/client-panel-check.mjs` M3 节（`[6]` 两块）19 项——state 含 `authSecret`/`authSecretConfigured`、write-only 草稿初始为空、
  state 序列化不含明文、保存经 `configForms` 原子写且带 revision 栅栏、空白不写、既有密钥仍识别为已配置。

### 3.4 M4 —— 同 sessionId 推理串行化

- `src/agent-engine.ts:210-232`：新增 per-sessionId `sessionGates: Map<string, Promise<unknown>>` 与 `enqueueSession`；`chat` 经 promise 链串行执行
  （前序任务无论成功/失败都继续链，`settled` 后清理该键）。修复 DSH Agent 共享 durable session 下并发 `followup` 后
  `summarizeAssistantText` 取到最后一条 `assistant/message` 导致串话的问题。
- `src/agent-engine.ts:323-325`：`dispose()` 首行 `sessionGates.clear()`，避免释放后仍有排队任务在已释放的 Agent 上执行（S-M4-1）。
- 实测：`scripts/e2e-check.mjs` 场景 5（两个 sessionId 并发隔离，回包 sessionId/userId 与动作均不串话）。

### 3.5 T10 —— 客户端半构建格式（tsdown CJS-factory）

- `package.json:28-30`：`build` = `tsc -p tsconfig.json && pnpm run build:client`；新增 `build:client` = `tsdown`；
  `tsdown` 列入 `devDependencies`（`package.json:70`）。
- `tsdown.config.ts`：`entry: ['src/client.ts']`、`format: 'cjs'`、`platform: 'browser'`，并用 `banner`/`footer` 把产物包成
  `window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports; }})`；`slots` / `locale` / `configForms` 及
  `react` / `@deepseek-ai/dsh-client-*` 运行时依赖全部 external（保留 `require(...)`）；`clean:false`（`lib/` 与 tsc 宿主半共用）。
- 产物证据：`lib/client.js` 首行即 `window.__ModuleLoader__.load({ id: "dsh-lumegaze/client", factory: (require) => {`，尾行 `return module.exports;` 后接 `}});`。
- 此前客户端半为裸 ESM，无法被 DSH 客户端模块系统消费；本次仅改构建格式，未改面板实现逻辑。
- host 半仍由 `tsc` 产出 ESM（`lib/index.js` 等），`exports` 子路径 `.` / `./client` 不变。
- 实测：`pnpm build`、`pnpm verify` 退出 0。

### 3.6 T12 附带 —— 幂等守卫

- `src/ws-server.ts:108-112` `start()` 已在运行守卫：`this.wss` 存在时记 warn 并忽略，不重复监听。
- `src/ws-server.ts:230-232` `isRunning()`：返回 `this.wss !== null`，供 M1 运行期翻转判定，重复 `true→true` 不重复启动。

### 3.7 T14 —— S-M1-2 宿主级启停 + S-3 / S-4 健壮性

**S-M1-2 宿主级启停（`ctx.remote.pluginManager.setPluginEnabled`）**

- 触发：面板「插件总开关」切换（`src/client/LumegazeCard.tsx:123-163`）。开启时同时 `props.edit('enabled', 'true')` 与
  `void props.setPluginEnabled(true)`；关闭方向先置 `confirmingDisable` 弹确认（文案 `pluginToggleDisableConfirm`），
  点「确认禁用」才 `props.edit('enabled', 'false')` 与 `void props.setPluginEnabled(false)`，「取消」只复位确认态、不调用。
- 宿主调用面：`LumegazeCardController.hostSetPluginEnabled` 经构造注入的 `pluginManager`（`PluginManagerRemoteLike`，
  即 `ctx.remote.pluginManager`，浏览器半 `TypertRemoteService` 远程命名空间）调 `setPluginEnabled(PLUGIN_ENTRY_ID, enabled)`
  （`src/client/lumegaze-card-controller.ts:175-207`、`:224-232`）。`PLUGIN_ENTRY_ID = 'lumegaze'`（`:218-222`）与
  `dsh.bundle.patch.yml` 的 Loader 行 id、`ctx.settings` 的 namespace 一致（`src/config.ts:19`）。
- 注入接线：`src/client.ts:24` `inject` 增加 `remote` / `remote.pluginManager`；`src/client.ts:46-49` 把 `ctx.remote?.pluginManager`
  传给控制器；`package.json:73-87` 的 `dsh.client.inject` 同步新增同名两项（T14 对 `package.json` 仅此项变化）。
- 失败回退：`remote` 未注入或 `setPluginEnabled` 非函数、宿主返回 `{ ok: false }`、调用抛错——三路均 `console.warn` 记日志并返回 `false`，
  面板不崩溃；插件内 `enabled` 草稿（`props.edit`）无论宿主调用成败都已写入，继续作运行期 WS 网关兜底（`src/client/lumegaze-card-controller.ts:189-207`）。
- 双级语义：宿主级 `setPluginEnabled` 管整个插件在 profile 中的启用/卸载（面板随之消失，可从 DSH 插件管理器重新启用）；
  插件内 `enabled` 管 WS 网关运行期启停（见 §3.1）。二者互不替代。

**S-3 —— disposer 非函数防御（`src/index.ts`）**

- `src/index.ts:287-300` 的 fiber dispose 回调中，对 `volatileUpdateDisposer` 与 `configureDisposer` 调用前均加
  `typeof === 'function'` 判断（`src/index.ts:290-291`），避免 bail 拦截导致 `ctx.on` 返回 truthy 非函数时被当函数调用而崩溃。

**S-4 —— `WsGateway` stop/start 关闭窗口竞态（`src/ws-server.ts`）**

- 新增状态：`closing` / `pendingStartPort` / `stopPromise` / `disposed`（`src/ws-server.ts:93-103`）。
- `start()`：已在运行时忽略；处于关闭窗口（`closing`）时只记录 `pendingStartPort` 并告警、不新建实例，避免旧实例与新实例并存（`src/ws-server.ts:108-118`）。
- `stop()`：置 `closing`、置空 `wss` 后关闭旧实例；重复调用返回同一个 `stopPromise`（幂等）；关闭完成后复位 `closing` 并补启窗口内记录的 `pendingStartPort`（`src/ws-server.ts:163-205`、`:216-223`）。
- 新增 `dispose()`：置 `disposed=true` 后走 `stop()`，但 `flushPendingStart()` 在 `disposed` 时直接返回，fiber dispose 后不再补启延迟 start（`src/ws-server.ts:207-223`）。
- 运行期联动：`src/index.ts:254-257` `enabled=false` 时**无条件** `void gateway.stop()`（即使 `isRunning()` 因关闭窗口为 false），以取消窗口内记录的延迟 start。
- 新增只读 `isClosing()`（`src/ws-server.ts:234-237`）。

**实测**

- `scripts/client-panel-check.mjs`：S-M1-2 新增 14 项（`[7]` 宿主级启停 8 项 + `[8]` 面板/client 接线与文案 6 项），合计 **71 passed / 0 failed**；
  覆盖成功路径入参 `lumegaze/true` / `lumegaze/false`、`{ ok:false }` 拒绝、调用抛错、remote 未注入兜底、面板开启/禁用确认调用与文案、`client.ts` 注入接线。
- `scripts/ws-gateway-check.mjs`：S-4 关闭窗口补启 / 幂等 / dispose 不补启路径全过（§14，脚本输出 `WS GATEWAY CHECK PASSED`）。
- `scripts/agent-engine-check.mjs` 92/0、`scripts/e2e-check.mjs` 27/0 不变。

---

## 4. 新错误码记录

### 4.1 `PLUGIN_DISABLED`（M1）

- 枚举：`src/protocol.ts:27`（`ErrorCode` 联合类型）。
- 触发：插件总开关 `enabled === false` 时收到 `chat` / `game_tick` 且网关处于运行态。
- 返回位置：`src/ws-server.ts:291-301`，`errorMsg` 为「插件已禁用，请先在配置面板开启插件总开关」。
- 行为：`success:false`、`action:[]`，**不调用引擎**；`toggle_walker_ai` 不受此码拦截。

### 4.2 `ACTION_TOO_LARGE`（M2 / S-M2-1）

- 枚举：`src/protocol.ts:30`（`ErrorCode` 联合类型）。
- 触发：引擎自称成功，但出站 `action` 中的动作**全部**被整项丢弃（超限 `json_action_too_large` 或畸形 `malformed_json_action`）。
- 返回位置：`src/protocol.ts:240-244`（`sanitizeEngineResult`）；引擎侧 `src/agent-engine.ts:312-314`（`runChat`）。
- 行为：`success:false`、`errorMsg`「动作超过大小上限，已整项丢弃」、`action:[]`。
- 评审建议项裁决：**部分动作被丢弃时仍 `success:true`**，丢弃项只记日志；只有「全部动作被丢弃」才回 `ACTION_TOO_LARGE`。
  空动作（无丢弃）同样保持 `success:true`（`scripts/agent-engine-check.mjs` 已覆盖三者边界）。

### 4.3 引擎层错误码说明

- `MODEL_NOT_CONFIGURED`（`src/agent-engine.ts:245`）与 `INVALID_LLM_OUTPUT`（`src/agent-engine.ts:295`）由引擎层以普通字符串返回，
  **不在** `src/protocol.ts:21-31` 的 `ErrorCode` 联合类型内（该联合只覆盖协议层/网关层码）。出站时经
  `makeOutbound` 原样透传，不参与 `ErrorCode` 静态校验。此点与 T11 评审建议一致，此处显式标注以免读者误以为已纳入协议枚举。

---

## 5. D8 / D9 / D10 实测结论与未验证标注

### D8 —— 真实安装 API 为 `installBundle`（已实测）

- 规格「插件市场 API」在真实 SDK 中不存在；唯一入口是
  `ctx.pluginManager.installBundle('billion-context', { enabled: true })`（SDK 文档 B11，`dsh-plugin-manager/lib/types/index.d.ts:123`）。
- 本插件实现：`src/billion-context.ts:134-204` `ensureInstalled()`，按 `ChangeResult.application`
  分类（`applied` / `restart-required` / `overridden` / `cancelled` / `failed`）记日志并短期降级。
- 安装时机：`apply()` 同步体**不 await** 安装；`src/index.ts:274-279` 用
  `void engine.ensureBillionInstalled().then(...).catch(...)` fire-and-forget 触发，避免在
  `apply()` 同步体内触发 profile 发布/reload（D8 风险项）。
- E2E 实测：`billion-context` 已装时 `installCalls.length === 0`（跳过安装），见 `scripts/e2e-check.mjs` 最后一节。

> 未验证：真实 profile 中「未安装 billion-context → 插件内 `installBundle` 的副作用边界」
> （是否会卸载重载自身、是否触发 `restart-required`）**未在本机实测**（本机 desktop/web profile 已装
> billion-context，插件走跳过分支）。风险已用「独立异步任务 + 已装跳过」规避，但真实首次安装路径未跑。

### D9 —— 服务端无业务数据接口，本期预留 + 日志（已实测降级路径）

- 服务端只有账号 HTTP 接口与 `/healthz`，无游戏业务数据接口（SDK 文档 D9，`server/src/net/httpApi.ts:72-89`）。
- 本插件实现（`src/server-client.ts`）：`serverUrl` 为空时**零 HTTP 请求**；非空时每次推理
  fire-and-forget 调 `GET {serverUrl}/healthz`（默认 5s 超时）；非 2xx / 超时 / 网络错误只写 `[server]` 日志，
  **不抛错、不阻断 AI 推理**（`src/agent-engine.ts:236-240`）。
- E2E 实测：
  - 连接拒绝（URL 指向无服务端口）→ AI 仍 `success=true`，且记录 `server request /healthz failed`；
  - 服务端挂起（>5s）→ AI 在 <2s 内返回，5s 后记录失败日志。
- 业务数据同步能力**未实现**（服务端无接口），规格「按需拉取/同步游戏数据」本期为预留扩展点。

### D10 —— billion-context 自动生效未在真实 profile 实测（明确未验证）

- 已核实事实：billion-context 是 bundle，仅插入 `bili-native` / `bili-compaction-gate` 两个 Loader 行，
  并在 LLM 流层 hook（`docs/billion-context-hook-finding.md`）；**未核实**到可被第三方插件直接调用的对外记忆 API。
- 本插件因此只做「状态检测 + 依赖其自动生效」，**不调用其 API、不自建向量库 / 记忆落盘**：
  - 检测：`listBundles()` 中 `name === 'billion-context'` 且 `installed && enabled` → 状态 A；
  - 否则状态 B（短期记忆降级），面板只读展示（`src/billion-context.ts:90-132`）；
  - 禁止卸载/修改：全仓库仅 `listBundles` + `installBundle` 两个调用面（`grep` 无 `uninstallBundle` /
    `disableBundle` / `setBundleEnabled` 等），见 `docs/SECURITY-AUDIT.md`。
- **未验证**：billion-context「自动 hook 到 Agent 并真正产生长期记忆召回/沉淀」未在真实 DSH profile
  （desktop/web）+ 真实模型下实测。本次仅验证了依赖检测、跳过安装、状态分类与降级日志。

---

## 6. 鉴权承载（`?token=` query 参数）—— 规格外扩展说明

- 规格（PLUGIN-SPEC 第四章 / 第七章）**未定义**插件 WS 鉴权；本地回环信任边界由 Q2 用户裁决补强。
- 实现（T7）：插件 `verifyClient` 在 `authSecret` 非空时同时接受两种承载——
  1. upgrade 头 `x-lumegaze-auth`；
  2. URL 查询参数 `?token=`（浏览器 / Tauri WebView 的 `WebSocket` 构造函数无法自定义 upgrade 头）。
  两者均用 `node:crypto.timingSafeEqual` 恒定时间比较，任一正确即放行，都缺失/错误则 401；
  `authSecret` 为空则不鉴权（向后兼容）。见 `src/ws-server.ts:128-149`。
- 客户端 `pluginBridge` 在 `pluginAuthToken` 非空时以 `encodeURIComponent` 拼接 `?token=`，为空则不加 query
  （`client/src/net/pluginBridge.ts:44-53`；跨仓观灵域客户端）。
- M3 补全了面板侧配置入口：面板「插件鉴权密钥」为 write-only secret，保存即写入 `authSecret` volatile 字段，握手即时生效（见 §3.3）。
- **风险与取舍（低）**：`?token=` 会出现在 WebSocket URL 中，可能被 WebView devtools / 客户端日志 / 代理访问日志
  记录。这是 WebView 无法自定义请求头下的既定取舍；密钥仍只在 127.0.0.1 回环内传输，不对外网暴露。
  已在 `docs/SECURITY-AUDIT.md` 列为观察项。
- 该承载为**规格外扩展**，不属于 PLUGIN-SPEC 第四章定义的报文字段，已在交付说明中显式声明。

---

## 7. 市场上架文案

### 7.1 简介

> **dsh-lumegaze · 观灵域行者 AI 网关**
>
> 把《观灵域》行者的 AI 决策交给 DSH 原生 Agent 引擎。插件在本地 127.0.0.1 开启 WebSocket 网关，
> 接收观灵域 Tauri 客户端的 `chat` / `game_tick` / `toggle_walker_ai` 报文，复用 DSH 的默认模型完成推理，
> 对 LLM 输出做强 JSON 校验后回传结构化的 `text / emotion / action`，并可选依赖 billion-context 提供长期记忆。
> 不调用任何第三方大模型 API、不自建向量库，缺失依赖自动降级，绝不因 AI 失败阻断客户端。
>
> **本插件需配套观灵域 Tauri 客户端使用，单独安装无法直接生效。**

### 7.2 使用说明

1. 安装并启用 `dsh-lumegaze`（需 DSH `>=0.2.1-rc.5`；首次安装会按需自动检测 / 安装 `billion-context`，失败仅告警降级）。
2. 打开插件设置面板，配置：
   - 插件总开关（双级：开启/关闭经宿主 `setPluginEnabled` 启用/停用整个插件，关闭需确认；插件内 `enabled` 继续作运行期 WS 网关开关，关闭后 `chat`/`game_tick` 回 `PLUGIN_DISABLED`）；
   - WebSocket 监听端口（默认 `8790`，仅绑定 `127.0.0.1`）；
   - 游戏服务端 URL（可留空；留空则不发起服务端 HTTP 请求）；
   - 行者通用人设 Prompt；
   - 插件鉴权密钥（留空则不鉴权；填写后客户端需填相同密钥；面板不回显已存密钥）；
   - 详细日志开关。
3. 启动观灵域 Tauri 客户端并登录，客户端会连接插件本地 WS；
4. 客户端下发 `toggle_walker_ai=true` 开启该用户的行者 AI 开关；
5. 客户端发送 `chat` / `game_tick`，插件返回结构化决策，客户端据此通过唯一 `/agent` 连接提交动作。
6. 关闭插件总开关需先确认，确认后经宿主 `setPluginEnabled` 停用整个插件（面板消失，可从 DSH 插件管理器重新启用）；插件内 `enabled` 继续作运行期 WS 网关开关，关闭后不再监听 WS 端口。关闭某用户的开关后，该用户所有 AI 请求被直接拦截（`WALKER_AI_DISABLED`），不消耗模型资源。

### 7.3 版本更新说明

**v0.1.0（首个上架版本）**

- 新增本地 WebSocket 网关（仅 127.0.0.1，支持握手鉴权：upgrade 头 / `?token=` 双承载，恒定时间比较）。
- 新增 `chat` / `game_tick` / `toggle_walker_ai` 三类报文处理与开关隔离（按 userId）。
- 新增插件总开关（`enabled`）运行期生效：关闭即停止 WS 网关并对 `chat` / `game_tick` 回 `PLUGIN_DISABLED`，运行期切换即时生效；T14 起开关同时经宿主 `setPluginEnabled` 做整个插件的启用/停用（关闭需确认，失败回退插件内 `enabled` 兜底）。
- 新增面板「插件鉴权密钥」（write-only，不回显明文，保存经 `configForms` 原子写，即时生效）。
- 新增同 sessionId 推理串行化，避免并发 `chat` / `game_tick` 串话。
- 超长 / 畸形 JSON 动作对象整项丢弃，不再截断成坏 JSON；仅当全部动作被丢弃时回 `ACTION_TOO_LARGE`。
- 接入 DSH 原生 Agent 推理（`ctx.agents.create` + `followup` / `whenIdle`），provider/model 跟随默认模型设置。
- 新增 LLM 决策 JSON 强校验 + 多路兜底修复；非法输出回 `INVALID_LLM_OUTPUT`，不崩溃、不透传。
- 新增 billion-context 依赖检测 / 自动安装 / 降级状态展示，绝不卸载或修改其配置。
- 新增服务端 HTTP 预留调用（`/healthz`，5s 超时），失败仅记日志、不阻断 AI。
- 新增插件配置面板（插件总开关 / 端口 / 服务端 URL / 人设 / 鉴权密钥 / 日志开关 / 记忆模式 / 依赖状态 / 用户开关只读列表）。
- 新增观灵域客户端配套：插件 WS 客户端、协议适配、推理来源切换，动作经唯一 `/agent` 连接提交。

---

## 8. 未验证项清单（明确标注）

| # | 未验证项 | 原因 | 已替代验证 |
| --- | --- | --- | --- |
| 1 | 插件在**真实 DSH profile**（desktop/web）内加载、启用、面板渲染 | 需在 DSH GUI 内安装/启用插件，本任务环境未执行 | 真实 `apply()` + 真实 `Context` + 真实 WS 网关 E2E（27 项）；面板单测 71 项 |
| 2 | **Tauri WebView** 内真实 `WebSocket` 连接与 `?token=` 握手 | 需 Tauri 客户端 GUI 实机 | Node `ws` 客户端真实握手 + 客户端 `pluginBridge` 单测（17 项，跨仓观灵域客户端，本次已实测 17/17） |
| 3 | billion-context **长期记忆真实生效**（真实 profile + 真实模型） | 未在真实 profile 跑真实推理 | 依赖检测 / 跳过安装 / 状态分类 / 降级日志已实测 |
| 4 | 服务端**业务数据接口**同步 | 服务端不存在该接口 | 降级路径（连接拒绝 / 超时）已实测 |
| 5 | 插件内 `installBundle` 的**副作用边界**（未安装场景是否触发自身重载） | 本机 profile 已装，走跳过分支 | 静态证据：独立异步 effect、同步体不 await、无自我重载代码 |
| 6 | `ctx.agentDefaultModel` 服务在真实 profile 的 provider/model **解析与切换** | 需真实 profile + 已配置模型 | 缺失/空 selection 回 `MODEL_NOT_CONFIGURED` 的降级路径已实测（agent-engine-check 92 项） |
| 7 | 大规模并发 / 长稳运行 | 超出本期范围 | 双 sessionId 并发隔离已实测 |
| 8 | 面板总开关经浏览器半 `ctx.remote.pluginManager` 到宿主 `setPluginEnabled` 的**真实 DSH GUI 端到端调用**（含宿主启用/卸载本插件、面板消失） | 需真实 DSH GUI 登录态 + 宿主 Remote 通道；本机仅以替身 mock 验证契约 | `src/client.ts` / `package.json` 注入接线静态核对 + S-M1-2 契约与失败路径单测 14 项（`client-panel-check.mjs` `[7]`–`[8]`） |

> 以上未验证项不影响本插件按当前实现上架，但上架后应在真实 DSH profile + 观灵域客户端实机复验第 1、2、3、6、8 项。
