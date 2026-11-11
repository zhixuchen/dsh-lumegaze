import { defineConfig } from 'tsdown'

/**
 * 浏览器半客户端打包配置。
 *
 * DSH 客户端模块系统只消费 `window.__ModuleLoader__.load({ id, factory })` 的
 * CJS-factory 格式（lazy CJS table：`factory(require)` → exports）。tsdown/rolldown
 * 的 `format: 'cjs'` 产出的是裸 CJS 模块体，故用 `banner`/`footer` 把它包成
 * factory：
 *
 *   window.__ModuleLoader__.load({ id: "dsh-lumegaze/client", factory: (require) => {
 *     var module = { exports: {} };
 *     var exports = module.exports;
 *     <tsdown CJS body>
 *     return module.exports;
 *   }});
 *
 * 运行态外部依赖（`slots`/`locale`/`configForms` 注入名，以及 react / dsh-client-ui-*
 * 运行时包）全部 external，保留为 `require(...)`，不打包进 bundle。
 *
 * 注意：`clean` 必须为 false —— outDir 与 tsc 共用 `lib/`，tsc 的宿主半产物与
 * `lib/client.d.ts` 需保留。
 */
const MODULE_ID = 'dsh-lumegaze/client'

const banner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(MODULE_ID)}, factory: (require) => {
var module = { exports: {} };
var exports = module.exports;`

const footer = `return module.exports;
}});`

export default defineConfig({
  entry: ['src/client.ts'],
  outDir: 'lib',
  format: 'cjs',
  // cjs 默认面向 Node；本 bundle 跑在浏览器，显式指定 browser 平台。
  inputOptions: { platform: 'browser' },
  // 固定输出名 `lib/client.js`（package.json `type: module` + cjs 默认会产出 `.cjs`）。
  fixedExtension: false,
  outExtensions: () => ({ js: '.js' }),
  // 输出文件名不带 hash，保持 `client.js` 稳定。
  hash: false,
  // 类型由 tsc 产出（`lib/client.d.ts`），此处不生成 dts，避免覆盖。
  dts: false,
  // 不清空 lib：tsc 宿主半产物与声明文件必须保留。
  clean: false,
  sourcemap: true,
  report: false,
  deps: {
    neverBundle: [
      'slots',
      'locale',
      'configForms',
      'remote',
      'remote.pluginManager',
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-store',
      '@deepseek-ai/dsh-client-ui-plugin-manager',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-slots',
      /^@deepseek-ai\/dsh-client-/,
    ],
  },
  banner: { js: banner },
  footer: { js: footer },
})
