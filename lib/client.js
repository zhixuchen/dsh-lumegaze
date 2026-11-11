/** 浏览器半插件显示名。 */
export const name = 'dsh-lumegaze/client';
/**
 * 浏览器半所需服务（S4 面板预留）：
 * - `slots`：注册设置面板槽位；
 * - `locale`：提供面板文案字典；
 * - `configForms`：绑定本插件的 settings namespace 读写配置。
 */
export const inject = ['slots', 'locale', 'configForms'];
/**
 * 浏览器半入口。
 *
 * S1 只导出空壳；S4 在此注册 `settings.plugins.tab` / `configForms` 贡献。
 * 这里刻意不 import 任何跨插件运行时值（客户端 bundle 纯净性门禁），只保留类型。
 */
export function apply(ctx) {
    // S4: 注册 settings.plugins.tab / configForms 贡献。
    void ctx;
}
//# sourceMappingURL=client.js.map