# 打包校验报告（T6）

> 目标：确认 `npm pack` 产物符合 DshPackageManifest，且无多余二进制 / 捆绑资源（node_modules、sourcemap、测试脚本等）。
> 方法：只读 + 最小配置改动后复验。命令：`npm pack --dry-run`、`npm pack --dry-run --json`。

## 1. 校验结论

**通过。** 最终发布 tarball：`dsh-lumegaze-0.1.0.tgz`，共 **38 个文件**，42.1 kB（packed）/ 213.7 kB（unpacked）。

| 校验点 | 结果 | 证据 |
| --- | --- | --- |
| 文件清单符合 DshPackageManifest | 通过 | 见第 2 节逐字段核对 |
| 无 node_modules 泄漏 | 通过 | 产物路径无 `node_modules/` |
| 无测试脚本误入 | 通过 | 产物路径无 `scripts/` |
| 无 sourcemap 外泄 | 通过（已修复） | 见第 3 节 |
| icon 合法（根目录内 SVG，≤256 KiB） | 通过 | `icon.svg` 602 B，位于包根 |

## 2. DshPackageManifest 逐字段核对

权威类型：`node_modules/@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts:7-90`
（字段仅 `name, version, description?, icon?, private?, dependencies?, peerDependencies?, engines?, dsh?`）。

| 字段 | 规范要求 | package.json 实际值 | 结论 |
| --- | --- | --- | --- |
| `name` | 必填 string | `"dsh-lumegaze"` | ✅ |
| `version` | 必填 string | `"0.1.0"` | ✅ |
| `description` | 可选 string | `"观灵域行者 AI 网关，需配套观灵域 Tauri 客户端使用"` | ✅ |
| `icon` | 可选，SVG/PNG/JPEG/WebP，相对包根、realpath 后仍在包内、≤256 KiB | `"icon.svg"`（602 B） | ✅ |
| `private` | 可选（本地 profile 项目防发布） | 未设置（上架包必须非 private） | ✅ |
| `dependencies` | 可选 Record | `@deepseek-ai/schemastery ~3.18.5`、`ws ^8.18.0` | ✅（`ws` 显式声明，符合 SDK B8 建议） |
| `peerDependencies` | 可选 Record | `cordis ~4.0.5`、`dsh-agent/dsh-llm/dsh-plugin-manager/dsh-session/dsh-settings 0.2.1-rc.5` | ✅ |
| `engines.dsh` | 可选 SemVer range | `>=0.2.1-rc.5` | ✅ |
| `engines.node` | 可选 | `>=20` | ✅ |
| `dsh.manifestVersion` | 可选（1） | 未设置 | ✅（可选） |
| `dsh.bundle.patch` | 单个 patch 文件路径或有序数组 | `./dsh.bundle.patch.yml`（存在，413 B） | ✅ |
| `dsh.client.platform` | 必填（Web 消费端取 `web`） | `"web"` | ✅ |
| `dsh.client.inject` | 可选 string[] | `["slots","locale","configForms"]` | ✅ |
| `dsh.permissions` / `dsh.capabilities` / `dsh.scope` | **不存在该字段** | 未设置 | ✅（D2 偏差，见 DELIVERY-NOTES） |

`package.json` 中 `main` / `types` / `exports` / `scripts` / `license` / `type` / `icon` 为 npm 常规字段，
不在 DshPackageManifest 声明面内，不冲突。

## 3. 多余产物核对与修复

### 3.1 修复项：`.map` 文件不再进入发布包

- 现象：`files: ["lib"]` 会把 `tsc` 生成的 `lib/**/*.js.map` 与 `lib/**/*.d.ts.map` 一并打包。
  修复前 tarball 共 **72 文件**，其中 **34 个 `.map`**（约一半体积）。
- 事实核对：这些 map **不含 `sourcesContent`**（`tsc` 未开 `inlineSources`），只引用 `../src/*.ts` 路径，
  因此不存在「源码正文外泄」，但仍属发布冗余，且暴露内部目录结构。
- 修复：`package.json` 的 `files` 由目录整体改为显式 glob，排除 map：

  ```json
  "files": ["lib/**/*.js", "lib/**/*.d.ts", "dsh.bundle.patch.yml", "icon.svg", "README.md"]
  ```

  影响面：仅发布包内容；`main`/`types`/`exports`/构建输出均不受影响；向后兼容（消费端无需 map）。
- 复验：map 数量 34 → **0**，总文件 72 → **38**，体积 59.9 kB → **42.1 kB**。

### 3.2 最终产物构成

- `lib/**/*.js` × 17
- `lib/**/*.d.ts` × 17
- 顶层：`package.json`、`README.md`、`dsh.bundle.patch.yml`、`icon.svg`
- 无：`node_modules/`、`scripts/`、`.git/`、`.idea/`、`docs/`、任何 `.map`、任何二进制。

### 3.3 复验命令

```bash
npm pack --dry-run            # 列出 38 个文件，name/version/filename 正确
npm pack --dry-run --json     # 机器可读核对
```

## 4. 复核记录

- `pnpm build` → 退出 0（tsc，无报错）
- `pnpm verify` → 退出 0（含配置/ disposer / WS / Agent 引擎 / 客户端面板 / E2E 全链）

> 说明：本报告只做打包事实核对；安全维度见 `docs/SECURITY-AUDIT.md`，功能联调见 `docs/E2E-REPORT.md`。
