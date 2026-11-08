import { type Options, type Snapshot } from './config.js';
import { type EventName, type Outcome } from './protocol.js';
export interface ShellResult {
    exitCode: number | null;
    timedOut?: boolean;
    aborted?: boolean;
    stdout: {
        text: string;
        truncated?: boolean;
    };
    stderr: {
        text: string;
        truncated?: boolean;
    };
}
export interface Shell {
    resolve(request: Record<string, unknown>): unknown;
    execute(spec: unknown): Promise<{
        result(): Promise<ShellResult>;
    }>;
}
export interface PermissionRequest {
    schema: 'dsh-hooks/approval-v1';
    sessionId: string;
    cwd: string;
    fingerprint: string;
    scope: 'session';
    hooks: {
        event: EventName;
        command: string;
        source: string;
        statusMessage?: string;
    }[];
}
export type Authorize = (request: PermissionRequest, signal: AbortSignal) => Promise<boolean>;
/** Protocol engine; every process uses the Harness shell, including remote/sandbox executors. */
export declare class HooksEngine {
    private shell;
    private authorize;
    readonly options: Options;
    private log;
    private sessions;
    private lifetime;
    private interval;
    constructor(shell: Shell, authorize: Authorize, options?: Options, log?: (message: string) => void);
    start(): void;
    attach(id: string, cwd: string): void;
    private state;
    refresh(id: string): Promise<Snapshot>;
    private permitted;
    revoke(id: string): void;
    stopWork(id: string): void;
    takeContexts(id: string): string[];
    run(id: string, event: EventName, payload: Record<string, unknown>, subjects: readonly string[], signal: AbortSignal, approvedOnly?: boolean): Promise<Outcome>;
    private command;
    private track;
    private enqueue;
    private limitContext;
    detach(id: string): Promise<void>;
    dispose(): Promise<void>;
}
