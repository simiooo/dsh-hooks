import { type Options, type Snapshot } from './config.js';
import { type EventName, type Outcome } from './protocol.js';
import type { PermissionChoice } from './policy.js';
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
export type Authorize = (request: PermissionRequest, signal: AbortSignal) => Promise<boolean | 'deferred'>;
export type HookDecision = 'allow-session' | 'allow-permanent' | 'deny';
export interface ManualAnswer {
    sessionId: string;
    id: string;
    fingerprint: string;
    decision: HookDecision;
}
/** Protocol engine; processes use the Harness shell and immutable session/revision lifetimes. */
export declare class HooksEngine {
    private shell;
    private authorize;
    private log;
    private sessions;
    private lifetime;
    private interval;
    private disposal;
    readonly options: Readonly<Options>;
    private trust;
    private hierarchy;
    constructor(shell: Shell, authorize: Authorize, options?: Options, log?: (message: string) => void);
    /** The plugin uses per-hook policies; the old standalone engine API remains compatible. */
    enableHierarchy(): void;
    policyCatalog(cwd: string, snapshot: Snapshot): Promise<{
        cwd: string;
        project: string;
        policyRevision: string;
        globalDefault: boolean;
        hooks: {
            enabled: boolean;
            id: string;
            version: string;
            event: string;
            command: string;
            source: string;
            name: string;
            choice: PermissionChoice;
            global: PermissionChoice;
            project: PermissionChoice;
            effective: "allow" | "deny" | "ask";
            from: "session" | "project" | "global" | "global-default" | "legacy" | "default";
            reviewRequired: boolean;
        }[];
        revision: string;
    }>;
    private refreshPolicies;
    setPolicy(cwd: string, snapshot: Snapshot, expected: string, scope: 'global' | 'project', key: string, choice: PermissionChoice, current: () => Promise<boolean>): Promise<void>;
    setDefaultPolicy(cwd: string, snapshot: Snapshot, expected: string, enabled: boolean, current: () => Promise<boolean>): Promise<void>;
    setSessionPolicy(id: string, revision: string, key: string, choice: PermissionChoice): Promise<{
        cwd: string;
        project: string;
        policyRevision: string;
        globalDefault: boolean;
        hooks: {
            enabled: boolean;
            id: string;
            version: string;
            event: string;
            command: string;
            source: string;
            name: string;
            choice: PermissionChoice;
            global: PermissionChoice;
            project: PermissionChoice;
            effective: "allow" | "deny" | "ask";
            from: "session" | "project" | "global" | "global-default" | "legacy" | "default";
            reviewRequired: boolean;
        }[];
        revision: string;
    }>;
    start(): void;
    attach(id: string, cwd: string): void;
    private state;
    private invalidate;
    refresh(id: string): Promise<Snapshot>;
    private valid;
    private permitted;
    revoke(id: string): void;
    private policy;
    private trusted;
    remember(request: PermissionRequest, signal: AbortSignal): Promise<void>;
    permissionStatus(id: string): Promise<{
        session: boolean;
        permanent: boolean;
        cwd?: never;
        problem?: never;
    } | {
        hierarchical?: boolean;
        policy?: {
            cwd: string;
            project: string;
            policyRevision: string;
            globalDefault: boolean;
            hooks: {
                enabled: boolean;
                id: string;
                version: string;
                event: string;
                command: string;
                source: string;
                name: string;
                choice: PermissionChoice;
                global: PermissionChoice;
                project: PermissionChoice;
                effective: "allow" | "deny" | "ask";
                from: "session" | "project" | "global" | "global-default" | "legacy" | "default";
                reviewRequired: boolean;
            }[];
            revision: string;
        };
        review?: {
            schema: "dsh-hooks/approval-v1";
            scope: "session";
            sessionId: string;
            cwd: string;
            fingerprint: string;
            hooks: {
                statusMessage?: string;
                event: "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PreCompact" | "PostCompact" | "Stop" | "Interrupt" | "SessionEnd";
                command: string;
                source: string;
            }[];
            id: string;
            manual: true;
        };
        cwd: string;
        session: boolean;
        permanent: boolean;
        fingerprint: string;
        hooks: {
            statusMessage?: string;
            event: "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PreCompact" | "PostCompact" | "Stop" | "Interrupt" | "SessionEnd";
            command: string;
            source: string;
        }[];
        problem?: never;
    } | {
        cwd: string;
        session: boolean;
        permanent: boolean;
        problem: string;
    }>;
    answerManual(request: ManualAnswer): Promise<boolean>;
    forget(id: string): Promise<void>;
    stopWork(id: string): void;
    retainContexts(id: string, outcome: Outcome): void;
    takeContexts(id: string): string[];
    collectContexts(id: string): Promise<string[]>;
    outcomeCurrent(id: string, outcome: Outcome): Promise<boolean>;
    run(id: string, event: EventName, payload: Record<string, unknown>, subjects: readonly string[], signal: AbortSignal, approvedOnly?: boolean): Promise<Outcome>;
    private runHierarchical;
    private enqueueLease;
    private runPoint;
    private command;
    private track;
    private enqueue;
    private limitContext;
    detach(id: string): Promise<void>;
    dispose(): Promise<void>;
}
