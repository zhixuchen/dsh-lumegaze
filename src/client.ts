import type { Context } from '@deepseek-ai/cordis'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ConfigForms } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LumegazeCard } from './client/LumegazeCard.js'
import {
  LumegazeCardController,
  type LumegazeSettings,
  type PluginManagerRemoteLike,
} from './client/lumegaze-card-controller.js'
import { NS, zh, en } from './client/locales.js'

/** 浏览器半插件显示名。 */
export const name = 'dsh-lumegaze/client'

/**
 * 浏览器半所需服务：
 * - `slots`：注册设置面板槽位（`plugins.item`）；
 * - `locale`：提供面板文案字典；
 * - `configForms`：绑定本插件的 settings namespace（`lumegaze`）读写配置；
 * - `remote`：S-M1-2 宿主级启停所需的 `ctx.remote.pluginManager` 远程命名空间；
 * - `remote.pluginManager`：确保该命名空间已挂载后再加载本面板（官方 plugin-manager 客户端同款）。
 */
export const inject: string[] = ['slots', 'locale', 'configForms', 'remote', 'remote.pluginManager']

/** 面板注册所需的浏览器服务（同时把对应 Context 增强并入编译面）。 */
export type LumegazeClientContext = Context & {
  locale: LocaleRuntime
  slots: SlotRegistry
  configForms: ConfigForms
  remote: { pluginManager?: PluginManagerRemoteLike }
}

/**
 * 浏览器半入口。
 *
 * 注册 Lumegaze 配置面板：先注册中英文案字典，再绑定 `configForms`，最后在 Host
 * 服务 `lumegaze` namespace 期间把面板注入 Plugins 页的 `plugins.item` 槽。
 * 这里刻意不 import 任何跨插件运行时值（客户端 bundle 纯净性门禁），只保留类型；
 * 运行态状态经 `configForms` 的 Config 值读取。
 */
export function apply(ctx: LumegazeClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-lumegaze: dictionaries')

  const controller = new LumegazeCardController(
    ctx.configForms.get<LumegazeSettings>('lumegaze'),
    ctx.remote?.pluginManager,
  )
  ctx.effect(() => () => controller.dispose(), 'ui-settings-lumegaze: form subscriptions')

  ctx.effect(
    () =>
      ctx.configForms.whileServed(['lumegaze'], () =>
        ctx.slots.inject('plugins.item', () =>
          ctx.slots.register(
            {
              name: 'plugins.item',
              id: 'lumegaze',
              order: 50,
              label: () => t('title'),
              locale: NS,
              inject: () => controller.inject(),
            },
            LumegazeCard,
          ),
        ),
      ),
    'ui-settings-lumegaze: page',
  )
}
