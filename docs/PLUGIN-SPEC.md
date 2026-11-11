# dsh-lumegaze 插件开发文档

## 文档说明

文档用途：交付开发工程师，作为唯一开发依据，严格按本文实现。
插件名称：dsh-lumegaze（观灵域 AI 中枢插件）
目标：作为《观灵域》游戏行者 AI 的中枢网关；**符合 DSH 插件市场规范，开发完成后可直接打包上架 DSH 插件市场**。

## 一、项目概述

本插件为《观灵域》提供行者 AI 能力网关，所有 AI 能力全部复用 DSH 原生生态，不自行实现大模型调用、记忆存储逻辑。
插件提供本地 WebSocket 接口，供观灵域 Tauri 游戏客户端连接；支持配置游戏服务端地址，可与游戏服务端进行 HTTP 交互；行者 AI 能力需要客户端登录后下发开关指令才能启用。

生态依赖：

- DSH 本体（基础运行环境）
- billion-context（可选增强依赖，提供长期向量记忆）

核心原则：

1. 不直接调用 Ollama 或任何大模型 API，全部走 DSH 原生 Agent 接口
2. 不自建记忆、向量库、对话历史存储，记忆能力全部交由 billion-context
3. 遵循 DSH 插件生命周期、权限、清单规范，满足上架审核
4. 缺失依赖时具备降级逻辑，不可崩溃

## 二、能力清单

1. 插件安装 / 启用时自动检测 billion-context：不存在则自动从市场安装并启用；已存在则跳过；安装失败仅告警，不阻断本插件启动
2. 配置面板可自定义：WebSocket 端口、游戏服务端 URL、行者通用人设 Prompt
3. 本地 WebSocket 服务，监听 127.0.0.1，支持多客户端、多行者并发会话
4. 基于 userId 的登录隔离 + 行者 AI 总开关控制：开关关闭时直接拦截所有 AI 请求，不调用 Agent
5. 接收客户端三种消息类型：chat、game_tick、toggle_walker_ai
6. 开关开启后，可按需向配置的游戏服务端 URL 发起 HTTP 业务交互；服务端请求失败仅打日志，不中断 AI 流程
7. 调用 DSH 原生 Agent 接口完成推理；自动检测 billion-context 状态，有则启用长期记忆，无则降级为短期上下文模式
8. 对 LLM 输出做 JSON 格式强校验，兜底修复、过滤非法输出
9. 日志分级输出：连接日志、开关变更日志、AI 推理日志、依赖状态日志、服务端请求日志
10. 卸载钩子：清理本插件自身配置，**禁止卸载 / 修改 billion-context**

## 三、依赖与降级规则

### 3.1 依赖分级

- 基础依赖：DSH 本体（必须）
- 增强可选依赖：billion-context（提供长期记忆）
- 无关组件：dsh-pet 等其他插件，无依赖

### 3.2 依赖自动安装逻辑

插件 enable 阶段执行检测：

1. 查询当前 DSH 已安装插件列表，判断是否存在 billion-context
2. 不存在 → 调用 DSH 插件市场 API 安装 billion-context，并启用
3. 已存在 → 跳过，不修改其配置、不重启
4. 安装失败（网络、市场不可用）→ 写入警告日志，插件继续运行，进入降级模式

### 3.3 记忆降级策略

- 状态 A：billion-context 已安装且启用 → 自动接入长期记忆，每一轮推理自动触发记忆召回、记忆沉淀
- 状态 B：未安装 / 禁用 / 加载失败 → 降级为短期上下文模式；仅保留当前会话窗口内对话；DSH 重启后会话记忆清空

>
降级状态在配置面板可视化展示

## 四、通信协议（WebSocket）

### 4.1 客户端 → 插件（入参）

```
{
  "sessionId": "string",
  "userId": "string",
  "type": "chat | game_tick | toggle_walker_ai",
  "content": "string | boolean",
  "timestamp": 1762780000
}
```

字段说明：

- `sessionId`：行者唯一会话 ID，与 userId 绑定，隔离不同行者
- `userId`：登录用户 ID，用于隔离开关状态
- `type=toggle_walker_ai`：content 为布尔值 true/false，开启 / 关闭该用户的行者 AI 总开关
- `type=chat`：content 为玩家对话文本
- `type=game_tick`：content 为游戏世界感知结构化数据

### 4.2 插件 → 客户端（返回）

```
{
  "sessionId": "string",
  "userId": "string",
  "text": "string",
  "emotion": "normal | happy | sad | shy | angry | calm",
  "action": ["string"],
  "success": true,
  "errorCode": "",
  "errorMsg": ""
}
```

错误样例（开关未开启）：

```
{
  "sessionId": "xxx",
  "userId": "xxx",
  "text": "",
  "emotion": "normal",
  "action": [],
  "success": false,
  "errorCode": "WALKER_AI_DISABLED",
  "errorMsg": "行者AI能力未开启，请先打开开关"
}
```

## 五、配置面板（DSH 插件内置 UI）

配置项全部持久化存储，DSH 重启保留：

1. 插件总开关：启用 / 禁用整个插件
2. WebSocket 监听端口输入框
3. 游戏服务端 URL 输入框，附带 URL 格式校验；空值 = 不发起服务端 HTTP 交互
4. 行者通用人设 Prompt 多行编辑框
5. 状态展示区：
   - 记忆模式：【已接入长期记忆】 / 【短期记忆降级模式】
   - 依赖状态：billion-context【已安装】 / 【未安装（自动安装失败）】
6. 用户开关状态只读列表：展示各个 userId 对应的 walkerAiEnable 状态
7. 日志开关：开启后输出详细运行日志

## 六、业务流程

1. 观灵域 Tauri 客户端启动，建立 WebSocket 连接
2. 用户登录后，客户端下发 `toggle_walker_ai=true`，开启该用户的行者 AI 开关；开关状态持久化
3. 客户端发送 chat /game_tick 请求
4. 插件校验：当前 userId 对应的 walkerAiEnable 是否为 true
   - false：直接返回 WALKER_AI_DISABLED 错误，不调用 Agent、不请求服务端
   - true：
     1. 如果配置了服务端 URL，按需向服务端发起 HTTP 请求拉取 / 同步游戏数据；失败写日志，不阻断流程
     2. 组装 Prompt（面板配置的人设 + 输入内容），调用 DSH 原生 Agent Chat 接口
     3. 若 billion-context 可用，自动绑定记忆召回、沉淀逻辑
     4. 校验 Agent 返回 JSON，校验失败做兜底处理
     5. 把结构化结果返回给 WebSocket 客户端

## 七、开发约束（强制）

1. ❌ 禁止直接调用 Ollama / 任何第三方大模型 API；所有推理必须走 DSH 原生 Agent 接口
2. ❌ 禁止自建向量库、记忆存储、对话持久化；记忆全部交给 billion-context
3. ❌ 禁止监听 0.0.0.0 公网端口；WebSocket 仅监听 127.0.0.1
4. ❌ 禁止越权卸载 billion-context，本插件卸载时只清理自己配置
5. ✅ 输出必须强 JSON 校验，防止 LLM 返回非法结构导致客户端崩溃
6. ✅ 开关关闭时，直接拦截，不消耗模型资源
7. ✅ 所有权限按需声明，清单文件严格遵循 DSH 插件市场规范
8. ✅ 实现完整生命周期钩子：install /enable/disable /uninstall
9. ✅ 打包产物符合 DSH 市场上传标准，无多余二进制、捆绑资源
10. ✅ 日志分级，不输出用户敏感信息

## 八、上架规范（必须满足）

1. manifest 清单包含：id、插件名称、版本号、作者、简介、图标、权限声明、依赖声明
2. 权限仅申请最小集合：Agent 调用、插件管理 API、本地配置存储、本地 WebSocket、HTTP 请求
3. 市场简介写明：本插件为《观灵域》行者 AI 网关，需要配套观灵域 Tauri 客户端使用
4. 版本更新说明、使用说明在清单内提供
5. 代码结构符合 DSH 插件开发标准目录结构

## 九、预留扩展点

1. 支持大批量行者并发 Tick 驱动
2. 预留按行者独立人格 Prompt 配置入口（当前版本只做全局通用人设）
3. 预留远程访问适配（对接 dsh-mobile-remote）
4. 后续可扩展：单行者独立开关，而不是用户全局开关
