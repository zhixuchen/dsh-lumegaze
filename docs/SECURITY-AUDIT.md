# 安全审计结论（T6）

> 范围：`src/`（插件实现）、`client/src/{net/pluginBridge,protocol/pluginProtocol,agent/pluginAdapter}.ts`（客户端配套）、
> 打包产物清单。方式：**只读核对 + 实跑 E2E**；不修改实现代码。
> 结论：**通过**（1 项低风险观察项，均有证据）。

## 1. 审计项逐条结论

| # | 审计项 | 结论 | 证据（只读） |
| --- | --- | --- | --- |
| 1 | 仅绑定 `127.0.0.1`，无 `0.0.0.0` | ✅ 通过 | `src/ws-server.ts:99` `host: '127.0.0.1'`；全库 `grep -rn "0\.0\.0\.0" src/` 仅命中注释（`src/ws-server.ts:5`）。运行期 `ws-gateway-check` 以 `ss/netstat/lsof` 取证无 `0.0.0.0` |
| 2 | 日志无敏感明文（authSecret / token / password） | ✅ 通过 | `src/logger.ts:39-47` 先按配置密钥精确替换为 `***`，再按 `key:value` 形态兜底；`ws-gateway-check` 断言日志 dump 不含 authSecret 明文。客户端插件模块无 `console` / 无 token 日志（`grep` 为空） |
| 3 | 无 Ollama / 第三方大模型直连 | ✅ 通过 | 推理仅经 `ctx.agents.create` + `followup`/`whenIdle`（`src/agent-engine.ts:190-285`）；`grep -rniE "ollama\|openai\|anthropic" src/` 无命中；无 `https://` 出站 |
| 4 | 无 billion-context 卸载 / 修改代码 | ✅ 通过 | 全库 `grep` 无 `uninstallBundle` / `disableBundle` / `setBundleEnabled` / `removeBundle`；仅 `listBundles`（`src/billion-context.ts:99`）+ `installBundle`（`:154`）两个调用面；E2E 断言已装时 `installCalls === 0` |
| 5 | 无自建向量库 / 记忆落盘 | ✅ 通过 | `grep -rniE "vector\|embedding\|sqlite\|redis\|writeFile\|readFile\|fs\." src/` 无命中；持久化仅经 `ctx.settings.mutate`（DSH 托管的 profile patch，`src/index.ts:117-141`）；`SessionRegistry` 只存元数据（`src/sessions.ts`），不存对话正文 |
| 6 | 输入校验 / 帧防护 | ✅ 通过 | `src/protocol.ts:102-151` 强校验（sessionId/userId/type/content）；`src/ws-server.ts:34,199-209` 256 KiB 帧上限 + `maxPayload`；`INVALID_JSON` / `INVALID_MESSAGE` / `UNSUPPORTED_TYPE` / `PAYLOAD_TOO_LARGE` 均返回错误报文不崩溃（`ws-gateway-check` 覆盖） |
| 7 | LLM 输出强校验不透传非法结构 | ✅ 通过 | `src/decision.ts` 多路兜底 + 12 项白名单；失败回 `INVALID_LLM_OUTPUT` 且 `action` 置空（`src/agent-engine.ts:264-268`）；E2E 场景 4 实测 |
| 8 | 开关关闭不消耗模型资源 | ✅ 通过 | `src/ws-server.ts:253-264` 先查 `switches.isEnabled`，关闭时直接回 `WALKER_AI_DISABLED` 不触达引擎；E2E 断言引擎调用计数不变 |
| 9 | 服务端 HTTP 失败不阻断、不越权 | ✅ 通过 | `src/server-client.ts:59-88` 空 URL 零请求、5s 超时、非 2xx / 异常只记 `[server]` 日志并返回 `ok:false`；仅访问用户配置的 `serverUrl`；E2E 场景 3a/3b 实测 |
| 10 | 握手鉴权恒定时间比较 | ✅ 通过 | `src/ws-server.ts:75-83` `timingSafeEqual`；`authSecret` 为空不鉴权（向后兼容）；头 / `?token=` 双承载（T7，规格外扩展，见 DELIVERY-NOTES §4） |
| 11 | 客户端不创建额外 `/agent` 连接 | ✅ 通过 | 插件通道只连插件 WS；动作提交仍走唯一 `/agent` 连接（客户端 `pluginT5` 单测 17/17，含「唯一 /agent 连接提交 action」） |

## 2. 观察项（低风险）

| # | 观察项 | 说明 | 处置 |
| --- | --- | --- | --- |
| O1 | 鉴权密钥以 `?token=` 出现在 WebSocket URL | WebView 无法自定义 upgrade 头，只能走 query；可能被 devtools / 客户端日志 / 本地代理日志记录 | 已接受（Q2 裁决）。密钥仅在 `127.0.0.1` 回环传输，不对外网暴露；若后续需要更高保证，可改为首次握手后由插件下发一次性会话 token |
| O2 | `authSecret` 以明文存于 DSH settings（profile patch） | DSH 无插件私有密钥存储（未核实到）；与 DSH 内其它 secret 同信任域 | 接受；不在日志 / 回包中出现 |

## 3. 修复对安全的影响

- 打包 `files` 收紧（排除 `.map`）：降低内部目录结构与源码路径暴露，**不影响运行安全**。
- 未对 `src/`、客户端实现做任何改动。

## 4. 复核命令

```bash
grep -rn "0\.0\.0\.0" src/                       # 仅注释
grep -rniE "ollama|openai|anthropic" src/       # 无命中
grep -rn "uninstallBundle\|disableBundle\|setBundleEnabled" src/   # 无命中
node scripts/ws-gateway-check.mjs               # 127.0.0.1 / 鉴权 / 脱敏 / 日志
pnpm verify                                     # 全链退出 0
```

> 事实声明：以上均为本机只读核对与实跑结果；「真实 DSH profile 内加载」与「Tauri WebView 实机握手」未验证，见 DELIVERY-NOTES §6。
