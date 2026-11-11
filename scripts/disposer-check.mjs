/**
 * 验证 ctx.effect 注册的 disposer 在 fiber dispose 时被调用。
 *
 * 用真实 cordis Context 加载编译产物 lib/index.js：
 * 1) 加载后 fiber.getEffects() 应含 1 个 label 为 'lumegaze: runtime' 的 effect；
 * 2) await fiber.dispose() 后该 effect 消失；
 * 3) 注册的日志 exporter 收到 'lumegaze runtime disposed'，证明 disposer 函数体确实执行。
 *
 * 运行：node scripts/disposer-check.mjs
 */
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../lib/index.js'

const messages = []
const ctx = new Context()
const offExporter = ctx.logger.exporter({ export: (message) => messages.push(message) })

const fiber = await ctx.plugin(plugin, {})

const before = fiber.getEffects()
const disposedLogged = () => messages.some((m) => String(m.args?.[0]).includes('lumegaze runtime disposed'))

await fiber.dispose()
offExporter()

const after = fiber.getEffects()

const problems = []
if (before.length !== 1) problems.push(`expected 1 registered effect before dispose, got ${before.length}`)
if (before[0]?.label !== 'lumegaze: runtime') problems.push(`unexpected effect label: ${before[0]?.label}`)
if (after.length !== 0) problems.push(`expected 0 effects after dispose, got ${after.length}`)
if (!disposedLogged()) problems.push('disposer body did not run (no "lumegaze runtime disposed" log)')

if (problems.length) {
  console.error('DISPOSER CHECK FAILED:\n' + problems.map((p) => ' - ' + p).join('\n'))
  process.exit(1)
}
console.log(
  'DISPOSER CHECK PASSED: effect registered on load, torn down on fiber.dispose(), disposer body executed',
)
