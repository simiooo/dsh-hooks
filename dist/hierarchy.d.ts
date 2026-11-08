import { type Options, type Snapshot } from './config.js';
import { PolicyStore, type PermissionChoice } from './policy.js';
export interface PermissionRow {
    id: string;
    version: string;
    event: string;
    command: string;
    source: string;
    name: string;
    enabled: boolean;
    choice: PermissionChoice;
    global: PermissionChoice;
    project: PermissionChoice;
    effective: 'allow' | 'deny' | 'ask';
    from: 'session' | 'project' | 'global' | 'global-default' | 'legacy' | 'default';
    reviewRequired: boolean;
}
interface Lease {
    token: string;
    version: string;
    controller: AbortController;
}
export declare class HookPermissions {
    private options;
    private legacy;
    private alive;
    readonly store: PolicyStore;
    private instances;
    private tail;
    constructor(options: Options, legacy: (cwd: string, snapshot: Snapshot) => Promise<boolean>, alive: () => boolean);
    attach(id: string, cwd: string): void;
    private state;
    private project;
    private resolve;
    private view;
    catalog(cwd: string, snapshot: Snapshot): Promise<{
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
    sync(id: string, snapshot: Snapshot): Promise<{
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
    private synchronize;
    lease(id: string, key: string): Lease | undefined;
    active(id: string, token: string): boolean;
    private stopInstance;
    stop(id: string): void;
    detach(id: string): void;
    revoke(id: string): void;
    reset(id: string): void;
    legacySession(id: string, snapshot: Snapshot, allow: boolean): void;
    private serial;
    setSession(id: string, expected: string, key: string, choice: PermissionChoice): Promise<{
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
    setDurable(cwd: string, snapshot: Snapshot, expected: string, scope: 'global' | 'project', key: string, choice: PermissionChoice, current: () => Promise<boolean>): Promise<void>;
    setDefault(cwd: string, snapshot: Snapshot, expected: string, enabled: boolean, current: () => Promise<boolean>): Promise<void>;
}
export {};
