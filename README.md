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

> S2 已落地本地 WebSocket 服务端、第四章协议编解码、userId 开关隔离、分级日志与
> S3 Agent 引擎接缝。Agent 推理、billion-context 检测/安装、服务端 HTTP 在 S3；
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

## 开发

```bash
pnpm install
pnpm build      # tsc -p tsconfig.json，产出 lib/index.js、lib/client.js 与 .d.ts
pnpm typecheck  # 仅类型检查
pnpm verify     # 校验 Config Schema、ctx.effect disposer 与 WS 网关端到端行为
```

目录结构：

```
package.json              清单（dsh.bundle.patch / dsh.client / peer / deps）
tsconfig.json             构建配置（tsc，等效 tsup）
dsh.bundle.patch.yml      Loader 补丁：插入 lumagaze 行
icon.svg                  市场图标
src/config.ts             Config Schema + volatile 读取helper + settings namespace
src/index.ts              宿主半：apply 装配 + ctx.effect 清理（wss.close）
src/client.ts             浏览器半：name/inject/apply（S4 面板预留）
src/protocol.ts           第四章报文编解码与强校验
src/engine.ts             LumegazeEngine 接口 + unavailableEngine + setEngine 接缝
src/logger.ts             五类分级日志 + 敏感信息脱敏
src/switches.ts           userId 开关运行态 + 持久化回调
src/sessions.ts           会话上下文登记（多 sessionId 隔离）
src/ws-server.ts          WebSocketServer：鉴权/帧防护/路由（127.0.0.1）
scripts/verify-config.mjs Config Schema 校验脚本
scripts/disposer-check.mjs ctx.effect disposer 生命周期校验脚本
scripts/ws-gateway-check.mjs S2 WebSocket 网关端到端校验脚本
```

## 生命周期说明（与 PLUGIN-SPEC 的差异）

- DSH/cordis **不存在** `install/enable/disable/uninstall` 四个插件生命周期钩子。
  插件生命周期只有 cordis `apply()` 加载 + `ctx.effect` 清理 + fiber
  `dispose/restart/update`。本插件在 `apply()` 内只做同步初始化，清理一律通过
  `ctx.effect` 注册（见 `src/index.ts`）。
- DSH 插件清单**没有** `permissions` 字段。能力通过 `engines.dsh`、
  `peerDependencies`（`@deepseek-ai/cordis` 等）与 `dependencies`（`ws`）声明，
  运行时能力由是否注入对应 Cordis 服务自然决定。
- 本插件**不**卸载、修改或依赖任何内部实现去操作 billion-context；相关检测与
  自动安装（如启用）只在后续阶段以独立异步 effect 实现，且绝不修改其配置。

## 版本更新说明

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
