/**
 * S3 Agent 引擎接缝（关键）。
 *
 * S2 只定义接口与默认占位实现，不实现任何真实 Agent 调用（那是 S3 范围）。
 * S3 通过 `setEngine(realEngine)` 无侵入注入；网关在每次 chat / game_tick 时
 * 经 `getEngine()` 取当前引擎，因此注入对运行中的服务即时生效。
 */
/** 默认未就绪引擎：明确返回 ENGINE_NOT_READY，绝不假装成功。 */
export const ENGINE_NOT_READY = 'ENGINE_NOT_READY';
export const unavailableEngine = {
    async chat() {
        return {
            text: '',
            emotion: 'normal',
            action: [],
            success: false,
            errorCode: ENGINE_NOT_READY,
            errorMsg: 'AI推理引擎尚未就绪',
        };
    },
};
/** 模块级可替换槽位：S3 用 `setEngine` 注入真实引擎。 */
export const engineSlot = {
    current: unavailableEngine,
};
/** 读取当前引擎（缺省永远是 unavailableEngine）。 */
export function getEngine() {
    return engineSlot.current;
}
function assertEngine(engine) {
    if (engine === null || typeof engine !== 'object') {
        throw new TypeError('engine must be an object');
    }
    if (typeof engine.chat !== 'function') {
        throw new TypeError('engine.chat must be a function');
    }
}
/**
 * 注入 / 替换引擎，返回被替换掉的旧引擎（便于测试与回滚）。
 * 传入非法实现会抛 TypeError，避免把网关拖入坏状态。
 */
export function setEngine(engine) {
    assertEngine(engine);
    const previous = engineSlot.current;
    engineSlot.current = engine;
    return previous;
}
/** 恢复默认占位引擎。 */
export function resetEngine() {
    return setEngine(unavailableEngine);
}
//# sourceMappingURL=engine.js.map