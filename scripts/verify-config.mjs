/**
 * 校验 Config Schema：5 个可编辑字段 + 1 个运行态字段，且全部 volatile。
 * 运行：node scripts/verify-config.mjs
 */
import { Config } from '../lib/config.js'

const expected = [
  { key: 'wsPort', type: 'number', fallback: 8790 },
  { key: 'serverUrl', type: 'string', fallback: '' },
  { key: 'personaPrompt', type: 'string', fallback: '' },
  { key: 'authSecret', type: 'string', fallback: '' },
  { key: 'logEnabled', type: 'boolean', fallback: false },
  { key: 'walkerAiSwitches', type: 'dict', fallback: {} },
]

const problems = []
const fields = Config.dict ?? {}
for (const { key, type, fallback } of expected) {
  const node = fields[key]
  if (!node) {
    problems.push(`missing field "${key}"`)
    continue
  }
  if (node.type !== type) problems.push(`"${key}" type is ${node.type}, expected ${type}`)
  if (node.meta?.volatile !== true) problems.push(`"${key}" is not volatile`)
  if (JSON.stringify(node.meta?.default) !== JSON.stringify(fallback)) {
    problems.push(`"${key}" default is ${JSON.stringify(node.meta?.default)}, expected ${JSON.stringify(fallback)}`)
  }
}

// 解析空输入：应得到全部默认值，且 volatile 字段被包成 Volatile 引用。
const resolved = Config({})
const scalarChecks = [
  ['wsPort', resolved.wsPort, 8790],
  ['serverUrl', resolved.serverUrl, ''],
  ['personaPrompt', resolved.personaPrompt, ''],
  ['authSecret', resolved.authSecret, ''],
  ['logEnabled', resolved.logEnabled, false],
]
for (const [key, node, fallback] of scalarChecks) {
  if (node === null || typeof node !== 'object' || typeof node.get !== 'function') {
    problems.push(`"${key}" is not a Volatile reference after resolve`)
    continue
  }
  if (JSON.stringify(node.get()) !== JSON.stringify(fallback)) {
    problems.push(`"${key}" resolved to ${JSON.stringify(node.get())}, expected ${JSON.stringify(fallback)}`)
  }
}
if (resolved.walkerAiSwitches === null || typeof resolved.walkerAiSwitches !== 'object' || typeof resolved.walkerAiSwitches.get !== 'function') {
  problems.push('"walkerAiSwitches" is not a Volatile reference after resolve')
} else if (JSON.stringify(resolved.walkerAiSwitches.get()) !== '{}') {
  problems.push(`"walkerAiSwitches" resolved to ${JSON.stringify(resolved.walkerAiSwitches.get())}, expected {}`)
}

if (problems.length) {
  console.error('CONFIG SCHEMA CHECK FAILED:\n' + problems.map((p) => ' - ' + p).join('\n'))
  process.exit(1)
}
console.log('CONFIG SCHEMA CHECK PASSED: 6 volatile fields (5 editable + 1 runtime), defaults verified')
