# billion-context 集成深度核实补充（E2 未核实项的补证）

> 来源：编排者只读核对 `/Users/admin/.dsh/profiles/desktop/node_modules/billion-context/dist/agent/dsh-native.js` 与 `dsh.bundle.patch.yml`。
> 用途：为「记忆降级/依赖检测」子任务提供事实依据，替代侦察报告 E2 中「billion-context 对外记忆 API 未核实」一项。

## 已核实事实

1. **`bili-native` 的注入面**：`export const name = "bili-native"; export const inject = ["tools","commands","agents"]`（`dsh-native.js` 尾部导出）。它依赖 `tools` / `commands` / `agents` 三个服务。
2. **hook 点在 LLM 流层，不在 Agent 层**：`apply(ctx)` 内 `ctx.inject(["llm"], () => onEvent("llm/stream", (options, next) => ...))` —— 拦截每一次 LLM 请求，按 `sessionId` 分 lane 做增量/压缩，并注入 `x-bili-plugin` 头。
3. **它注册自己的工具与命令**：`toolDefinition(...)` 把 bili 工具注册进 `ctx.tools`；`ctx.commands.register({name:"acp", ...})` 与 `acp-cache`。
4. **无对外记忆 API**：`dsh-native.js` 的导出面只有 `apply/inject/name/planNativeDsh/...` 与一批 `_forTest` 内部钩子；**不存在** `recall/remember/settle/memory` 之类的公开服务方法可供第三方插件调用。其「记忆」= 代理侧的会话 lane + 上下文压缩，内部私有。
5. **归属要求**：`attributionOf(ctx)` 要求存在带 session id 的活跃 initiator；插件经 `ctx.agents.create` 创建的 agent 自带 initiator 归属，会被正确接管；无归属的直连请求会被拒绝并直发（不压缩）。
6. **bundle 层**：`dsh.bundle.patch.yml` 插入 `bili-native` 与 `bili-compaction-gate` 两行，并把 `compaction-basic` 置 `auto:false`、给 4 个 preset 注入 `biliBasicCompactionPolicy`；`bili-compaction-gate` 是独立常开行，**不得禁用**。

## 对实现的含义

- 插件**只需做状态检测**：`ctx.pluginManager.listBundles()` 中 `name === 'billion-context'` 且 `installed && enabled` → 状态 A（长期记忆已接入）；否则状态 B（短期降级）。
- 插件**不得**试图调用 billion-context 的记忆 API（不存在），也**不得**自建向量库/落盘记忆（违反规格第七章第 2 条）。
- 状态 B 的「短期上下文模式」= 插件在内存中为每个 `sessionId` 保留本轮会话窗口内的对话数组（不落盘、DSH 重启即清空），作为 Agent 调用的上下文拼接来源。
- 自动安装：不存在时 `ctx.pluginManager.installBundle('billion-context', { enabled: true })`；`ChangeResult.application === 'applied'` 才算成功，`'restart-required'`/`'failed'` 记警告并降级。
- 风险：在插件自身 `apply()` 同步体内 await `installBundle` 可能触发 profile 发布/重载，导致本插件被卸载重载（未实测，需在实现时用独立异步 effect + 异常捕获规避，并在交付说明中标注）。
