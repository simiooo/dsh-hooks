/** Optional adapter for Harness BasicCompactionEngine's documented summarizer seam.
 * It delegates selection, replay, summarization, commit, pruning and flushing unchanged.
 * The host currently exposes no awaited pre/post-compaction events.
 */
interface Owner {
    session: {
        snapshotEvents(): readonly any[];
    };
    runMaintenance?<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T>;
}
export interface CompactionHooks {
    before(owner: Owner, trigger: 'manual' | 'auto', signal: AbortSignal): Promise<void>;
    after(owner: Owner, trigger: 'manual' | 'auto', signal: AbortSignal): Promise<void>;
    warn(message: string): void;
}
export declare function installCompactionBridge(service: object, hooks: CompactionHooks): {
    dispose(): Promise<void>;
};
export {};
