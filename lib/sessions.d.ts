/**
 * 每个 sessionId 的独立会话上下文（规格第二章 3 / 第六章：多客户端多行者并发）。
 *
 * 说明：本插件按约束不自建对话持久化（记忆交给 billion-context / S3），
 * 因此这里只保存轻量运行态元数据（归属 userId、创建/活跃时间、消息计数），
 * 不保存对话正文；出站报文始终以「当次入站报文」的 sessionId / userId 回填，
 * 从结构上保证不串话。
 */
export interface SessionRecord {
    sessionId: string;
    userId: string;
    createdAt: number;
    lastActivityAt: number;
    messageCount: number;
}
export declare class SessionRegistry {
    private readonly sessions;
    /** 记录一次入站交互；已有 session 更新归属与计数，没有则新建。 */
    touch(sessionId: string, userId: string, now?: number): SessionRecord;
    get(sessionId: string): SessionRecord | undefined;
    get size(): number;
    clear(): void;
}
//# sourceMappingURL=sessions.d.ts.map