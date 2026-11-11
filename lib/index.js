import { Config, readVolatile, SETTINGS_NAMESPACE } from './config.js';
import { errorMessage, LumegazeLogger } from './logger.js';
import { resetEngine } from './engine.js';
import { SessionRegistry } from './sessions.js';
import { WalkerSwitches } from './switches.js';
import { WsGateway } from './ws-server.js';
/** 插件显示名（fiber 日志 / Loader 诊断）。 */
export const name = 'dsh-lumegaze';
/**
 * 宿主侧所需 Cordis 服务。
 *
 * 仍保持为空：S2 的 WS 服务与日志只依赖 core（logger / fiber / effect）；
 * `ctx.settings` 通过 `ctx.reflect.get('settings')` 可选访问——存在则持久化开关，
 * 不存在则降级为内存态并记依赖日志，插件绝不因此加载失败（规格第三章降级规则）。
 * S3 接入 Agent 推理时再按需加入 `agents` / `pluginManager`（见 DSH peer 声明）。
 */
export const inject = [];
export { Config, SETTINGS_NAMESPACE };
/** S3 Agent 引擎接缝：setEngine / getEngine / unavailableEngine。 */
export { ENGINE_NOT_READY, getEngine, resetEngine, setEngine, unavailableEngine, } from './engine.js';
export { MAX_FRAME_BYTES } from './ws-server.js';
/** 可选读取 settings 服务；未注入 / 形状不符时返回 undefined（不抛错）。 */
function resolveSettings(ctx) {
    try {
        const service = ctx.reflect.get('settings');
        if (service && typeof service.describe === 'function' && typeof service.mutate === 'function') {
            return service;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
/** 构造开关持久化回调：整表写回 volatile 字段 walkerAiSwitches。 */
function createPersistSwitches(ctx, logger) {
    return async (snapshot) => {
        const settings = resolveSettings(ctx);
        if (!settings) {
            logger.dependency('settings service unavailable; walkerAiSwitches persistence skipped');
            return false;
        }
        try {
            const rows = settings.describe({ redactSecrets: true });
            const row = rows.find((item) => item.ns === SETTINGS_NAMESPACE);
            await settings.mutate(SETTINGS_NAMESPACE, [{ op: 'set', path: ['walkerAiSwitches'], value: snapshot }], row?.revision);
            return true;
        }
        catch (error) {
            logger.server('persist walkerAiSwitches failed: %s', errorMessage(error));
            return false;
        }
    };
}
/**
 * 插件入口。
 *
 * 遵循 DSH/cordis 真实生命周期（D1）：不存在 install/enable/disable/uninstall
 * 钩子，这里只做同步初始化，所有资源清理通过 `ctx.effect` 注册（wss.close()、
 * 开关 / 会话表清理），fiber dispose 时由 cordis 逆序调用 disposer。
 * 不 await 任何安装/网络调用；S3 的 Agent 推理与 billion-context 检测另行承载。
 */
export function apply(ctx, config) {
    const logger = ctx.logger(name);
    const llogger = new LumegazeLogger({
        base: logger,
        isDetailed: () => readVolatile(config.logEnabled) === true,
        secrets: () => {
            const secret = readVolatile(config.authSecret);
            return secret ? [secret] : [];
        },
    });
    const switches = new WalkerSwitches(readVolatile(config.walkerAiSwitches));
    switches.setPersist(createPersistSwitches(ctx, llogger));
    const sessions = new SessionRegistry();
    const gateway = new WsGateway({
        switches,
        sessions,
        logger: llogger,
        authSecret: () => readVolatile(config.authSecret),
    });
    // S2 落地默认占位引擎；S3 通过 setEngine(realEngine) 无侵入注入。
    resetEngine();
    ctx.effect(() => {
        const port = readVolatile(config.wsPort);
        gateway.start(port);
        llogger.dependency('settings service available: %s', resolveSettings(ctx) !== undefined);
        llogger.server('serverUrl configured: %s (S2 不发起服务端 HTTP，HTTP 交互在 S3)', readVolatile(config.serverUrl).length > 0);
        logger.info('lumegaze runtime initialized (host=127.0.0.1, wsPort=%s, logEnabled=%s)', port, readVolatile(config.logEnabled));
        return async () => {
            await gateway.stop();
            switches.clear();
            sessions.clear();
            logger.info('lumegaze runtime disposed');
        };
    }, 'lumegaze: runtime');
}
//# sourceMappingURL=index.js.map