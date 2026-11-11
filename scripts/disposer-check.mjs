/**
 * 验证 ctx.effect 注册的 disposer 在 fiber dispose 时被调用。
 *
 * 用真实 cordis Context 加载编译产物 lib/index.js：
 * 1) 加载后 fiber.getEffects() 应含 3 个 effect（S2 的 'lumegaze: runtime'、
 *    S3 的 'lumegaze: agent-engine' 与 M1 运行期监听 'ctx.on("loader/volatile-update")'）；
 * 2) await fiber.dispose() 后全部消失；
 * 3) 注册的日志 exporter 收到 'lumegaze runtime disposed'，证明 disposer 函数体确实执行。
 *
 * T17 S-3 加固：再以 global `internal/listener` bail 注入，令 `ctx.on` 对
 * `loader/volatile-update` 返回 truthy 非函数，验证 disposer 的 `typeof === 'function'`
 * 防御路径不崩溃、不残留监听，且 disposer 体仍执行。
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
const beforeLabels = before.map((effect) => effect?.label).sort()

const problems = []
if (before.length !== 3) problems.push(`expected 3 registered effects before dispose, got ${before.length}`)
if (
  JSON.stringify(beforeLabels) !==
  JSON.stringify(['ctx.on("loader/volatile-update")', 'lumegaze: agent-engine', 'lumegaze: runtime'])
) {
  problems.push(`unexpected effect labels: ${JSON.stringify(beforeLabels)}`)
}
if (after.length !== 0) problems.push(`expected 0 effects after dispose, got ${after.length}`)
if (!disposedLogged()) problems.push('disposer body did not run (no "lumegaze runtime disposed" log)')

// ---- T17 S-3：非函数 disposer（ctx.on bail 命中）防御性定向测试 ----
// 注入 global internal/listener bail：仅拦截 loader/volatile-update，使 ctx.on
// 返回 truthy 非函数（'bailed-non-function'）且不注册监听。断言 disposer 不崩溃、
// 监听未注册、dispose 后 effect 全清、disposer 体仍执行。
{
  const bailCtx = new Context()
  const bailMessages = []
  const bailExporter = bailCtx.logger.exporter({ export: (message) => bailMessages.push(message) })
  let bailed = null
  const bailOff = bailCtx.on(
    'internal/listener',
    (eventName) => {
      if (eventName === 'loader/volatile-update') {
        bailed = 'bailed-non-function'
        return bailed
      }
      return undefined
    },
    { global: true },
  )

  const bailFiber = await bailCtx.plugin(plugin, {})
  if (bailed !== 'bailed-non-function') {
    problems.push(`S-3 bail 未命中：ctx.on 未返回非函数 disposer（bailed=${JSON.stringify(bailed)}）`)
  } else {
    console.log('PASS  S-3: bail 注入使 ctx.on("loader/volatile-update") 返回非函数 disposer')
  }

  const bailLabels = bailFiber.getEffects().map((effect) => effect?.label).sort()
  if (!bailLabels.includes('ctx.on("loader/volatile-update")')) {
    console.log('PASS  S-3: bail 命中时不注册 volatile-update 监听 effect')
  } else {
    problems.push(`S-3 bail 命中后仍注册了监听 effect: ${JSON.stringify(bailLabels)}`)
  }

  let bailThrew = null
  try {
    await bailFiber.dispose()
  } catch (error) {
    bailThrew = error
  }
  if (bailThrew !== null) {
    problems.push(`S-3 非函数 disposer 导致 dispose 崩溃: ${String(bailThrew?.message ?? bailThrew)}`)
  } else {
    console.log('PASS  S-3: 非函数 disposer 不导致 fiber dispose 崩溃')
  }

  if (bailFiber.getEffects().length !== 0) {
    problems.push(`S-3 dispose 后仍有残留 effect: ${bailFiber.getEffects().length}`)
  } else {
    console.log('PASS  S-3: dispose 后 effect 全部清理')
  }

  if (!bailMessages.some((m) => String(m.args?.[0]).includes('lumegaze runtime disposed'))) {
    problems.push('S-3 disposer 体未执行（缺少 "lumegaze runtime disposed" 日志）')
  } else {
    console.log('PASS  S-3: disposer 体在非函数 disposer 路径下仍执行')
  }

  bailOff()
  bailExporter()
}

if (problems.length) {
  console.error('DISPOSER CHECK FAILED:\n' + problems.map((p) => ' - ' + p).join('\n'))
  process.exit(1)
}
console.log(
  'DISPOSER CHECK PASSED: 3 effects registered on load (runtime + agent-engine + volatile-update listener), torn down on fiber.dispose(), disposer body executed; S-3 bail path (non-function disposer) does not crash and cleans up',
)
