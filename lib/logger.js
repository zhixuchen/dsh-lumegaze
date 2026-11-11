/**
 * 分级日志（规格第七章 10 / 第二章 9）：连接、开关变更、AI 推理占位、
 * 依赖状态、服务端请求五类。
 *
 * - `logEnabled` 只控制「详细度」：连接 / 开关变更 / 错误始终记录；
 *   inference / dependency / server 三类在关闭时静默，避免噪声与敏感信息扩散。
 * - 任何写入日志的文本都会先经过敏感信息脱敏：本插件配置的 authSecret
 *   以及常见的 token / secret / authorization 头值一律替换为 `***`。
 */
const SENSITIVE_HEADER_PATTERN = /(x-lumegaze-auth|authorization|x-auth-token|token|secret|apikey|api-key|password)\s*[:=]\s*(?:Bearer\s+)?[^\s,;"'<>]+/gi;
export class LumegazeLogger {
    base;
    isDetailed;
    secrets;
    constructor({ base, isDetailed, secrets = () => [] }) {
        this.base = base;
        this.isDetailed = isDetailed;
        this.secrets = secrets;
    }
    /** 脱敏：先按已知密钥精确替换，再按 key:value 形态兜底。 */
    scrub(text) {
        let out = text;
        for (const secret of this.secrets()) {
            if (typeof secret === 'string' && secret.length >= 4) {
                out = out.split(secret).join('***');
            }
        }
        return out.replace(SENSITIVE_HEADER_PATTERN, (_match, key) => `${key}:***`);
    }
    emit(level, tag, format, ...params) {
        try {
            this.base[level](`[${tag}] ${this.scrub(String(format))}`, ...params.map((param) => typeof param === 'string' ? this.scrub(param) : param));
        }
        catch {
            // 日志本身绝不能影响业务；静默丢弃。
        }
    }
    /** 连接类日志：始终记录。 */
    connection(format, ...params) {
        this.emit('info', 'connection', format, ...params);
    }
    /** 开关变更日志：始终记录（规格第二章 9 / 验收关注点）。 */
    switch(format, ...params) {
        this.emit('info', 'switch', format, ...params);
    }
    /** AI 推理占位日志：仅 logEnabled 时输出。 */
    inference(format, ...params) {
        if (!this.isDetailed())
            return;
        this.emit('info', 'inference', format, ...params);
    }
    /** 依赖状态日志：仅 logEnabled 时输出。 */
    dependency(format, ...params) {
        if (!this.isDetailed())
            return;
        this.emit('info', 'dependency', format, ...params);
    }
    /** 服务端请求日志：仅 logEnabled 时输出。 */
    server(format, ...params) {
        if (!this.isDetailed())
            return;
        this.emit('info', 'server', format, ...params);
    }
    /** 通用 info。 */
    info(format, ...params) {
        this.emit('info', 'connection', format, ...params);
    }
    /** 告警：始终记录。 */
    warn(format, ...params) {
        this.emit('warn', 'dependency', format, ...params);
    }
    /** 错误：始终记录。 */
    error(format, ...params) {
        this.emit('error', 'dependency', format, ...params);
    }
}
/** 把未知异常转为可安全写日志的短消息（不含堆栈中的密钥字段）。 */
export function errorMessage(error) {
    if (error instanceof Error)
        return `${error.name}: ${error.message}`;
    if (typeof error === 'string')
        return error;
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
}
//# sourceMappingURL=logger.js.map