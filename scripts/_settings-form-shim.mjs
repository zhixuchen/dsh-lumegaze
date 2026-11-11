/**
 * 测试替身：`@deepseek-ai/dsh-client-ui-primitives` 的瘦替身。
 *
 * 背景：官方 primitives 包的主入口 `lib/index.js` 是把 React / clsx / react-dom /
 * simple-icons / CSS modules 等宿主依赖打在一起的大 bundle，插件 `node_modules`
 * 不含这些宿主依赖，Node 直连会 `ERR_MODULE_NOT_FOUND`（且 `.module.css` 无法被
 * Node ESM 解析）。本插件控制器只用到 `SettingsFormModel` / `settingsNumberField` /
 * `settingsTextField` 三个符号。
 *
 * 这里按官方实现逐行移植这三个符号（见
 * `.../dsh-client-ui-primitives/lib/index.js` SettingsFormModel / 字段工厂），
 * 仅用于在无头环境验证本插件控制器的接线（字段 spec、projection、write-only
 * secret 原子写）。控制器类本身仍是真实编译产物，未做替身。
 *
 * `@deepseek-ai/dsh-client-store` 的主入口也依赖宿主侧 zustand，故这里内联一个
 * 最小 snapshot store（仅 `getSnapshot` / `set`），不改变被测控制器语义。
 */
console.error('[SHIM] loaded')

/** 最小 snapshot store（等价官方 `createSnapshotStore(init)` 的读取面）。 */
function createSnapshotStore(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    set: (next) => {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

/** 整数字字段（官方 `settingsNumberField`）。 */
export function settingsNumberField(field) {
  return {
    field,
    format: (value) => (typeof value === 'number' ? String(value) : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/** 自由文本字段（官方 `settingsTextField`）。 */
export function settingsTextField(field) {
  return {
    field,
    format: (value) => (typeof value === 'string' ? value : ''),
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

/** 官方 `SettingsFormModel` 的忠实移植（仅去掉注释与类型）。 */
export class SettingsFormModel {
  constructor(scope, specs, secrets = []) {
    this.scope = scope
    this.specs = new Map(specs.map((spec) => [spec.field, spec]))
    this.secretSpecs = new Map(secrets.map((spec) => [spec.field, spec]))
    this.staged = new Map()
    this.listeners = new Set()
    this.unsubscribe = scope.subscribe(() => {
      this.publish()
    })
  }

  bind(project) {
    const store = createSnapshotStore(project())
    this.listeners.add(() => {
      store.set(project())
    })
    return store
  }

  shell() {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some((item) => item.run === undefined && item.op === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  field(field) {
    const staged = this.staged.get(field)
    if (this.secretSpecs.has(field)) {
      return { text: staged?.text ?? '', overridden: false, invalid: false }
    }
    const spec = this.spec(field)
    if (staged === undefined) {
      return {
        text: spec.format(this.sectionValue(field)),
        overridden: this.stored(field),
        invalid: false,
      }
    }
    const write = staged.clear ? { kind: 'clear' } : spec.parse(staged.text)
    return { text: staged.text, overridden: write?.kind === 'set', invalid: write === undefined }
  }

  actions() {
    return {
      edit: (field, text) => {
        this.stage(field, { text, clear: false })
      },
      resetField: (field) => {
        this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true })
      },
      save: () => {
        this.save()
      },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.baseline = undefined
        this.failed = false
        this.publish()
      },
    }
  }

  async save() {
    const plan = this.plan()
    if (!plan.length || this.saving || !this.scope.getSnapshot().writable || plan.some((item) => item.run === undefined && item.op === undefined)) {
      return
    }
    this.saving = true
    this.failed = false
    this.publish()
    try {
      const ops = plan.flatMap((item) => (item.op === undefined ? [] : [item.op]))
      let landed = !ops.length || (await this.scope.mutate(ops, this.baseline?.revision))
      if (!landed) {
        this.failed = true
        return
      }
      for (const item of plan) if (item.run) landed = (await item.run()) && landed
      if (landed) {
        this.staged.clear()
        this.baseline = undefined
      }
      this.failed = !landed
    } catch {
      this.failed = true
    } finally {
      this.saving = false
      this.publish()
    }
  }

  dispose() {
    this.unsubscribe()
    this.listeners.clear()
  }

  plan() {
    const plan = []
    for (const [field, staged] of this.staged) {
      const secret = this.secretSpecs.get(field)
      if (secret !== undefined) {
        const value = staged.text.trim()
        if (value !== '') plan.push({ field, run: () => secret.write(value) })
        continue
      }
      const spec = this.spec(field)
      if (staged.clear) {
        if (this.stored(field)) plan.push({ field, op: { op: 'unset', path: [field] } })
        continue
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ field })
      else if (write.kind === 'clear') plan.push({ field, op: { op: 'unset', path: [field] } })
      else plan.push({ field, op: { op: 'set', path: [field], value: write.value } })
    }
    return plan
  }

  stage(field, edit) {
    this.baseline ??= this.scope.getSnapshot()
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  spec(field) {
    const spec = this.specs.get(field)
    if (spec === undefined) throw new Error(`plugin card has no field ${field}`)
    return spec
  }

  snapshotOf() {
    return this.scope.getSnapshot()
  }

  sectionValue(field) {
    return this.snapshotOf().value?.[field]
  }

  baseValue(field) {
    return this.snapshotOf().base?.[field]
  }

  userLayer() {
    return this.snapshotOf().user
  }

  stored(field) {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field)
  }

  publish() {
    for (const listener of this.listeners) listener()
  }
}
