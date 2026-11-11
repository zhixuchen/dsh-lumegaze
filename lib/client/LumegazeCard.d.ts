/**
 * Lumegaze 配置面板（DSH 插件内置设置页）。
 *
 * 覆盖规格第五章全部 7 项（插件总开关、WebSocket 端口、游戏服务端 URL（含格式校验）、
 * 行者通用人设 Prompt（多行）、状态展示区（记忆模式 / 依赖状态）、用户开关只读列表、
 * 日志开关），并追加 M3 插件鉴权密钥（write-only secret，对应客户端 token 输入框）。
 * 运行态数据经 `ctx.configForms.get('lumegaze')` 读取，随 toggle 实时更新。
 */
import { type ReactElement } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import type { LumegazeCardFace } from './lumegaze-card-controller.js';
/** 面板组件 props：`plugins.item` 运行契约 + 本页字典 + 注册侧业务面。 */
export type LumegazeCardProps = PropsRuntime<'plugins.item'> & PropsLocale<'settings.lumegaze'> & InjectFace<LumegazeCardFace>;
/** `plugins.item` owner 契约（导入同时把该 slot 声明并入编译面）。 */
export type LumegazeItemOwner = PluginConfigViewProps;
/**
 * 渲染 Lumegaze 面板：一行摘要，或（view === 'page'）完整配置表单。
 * @param props - 渲染器绑定的 view、本页字典与注册侧业务面。
 */
export declare function LumegazeCard(props: LumegazeCardProps): string | ReactElement;
//# sourceMappingURL=LumegazeCard.d.ts.map