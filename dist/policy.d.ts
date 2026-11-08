import { type Options } from './config.js';
export type PermissionChoice = 'inherit' | 'allow' | 'deny';
export interface PermissionRule {
    decision: 'allow' | 'deny';
    versions: string[];
}
export interface PolicyDocument {
    schema: 'dsh-hooks/policy-v1';
    revision: string;
    defaultAllow: boolean;
    global: Record<string, PermissionRule>;
    projects: Record<string, Record<string, PermissionRule>>;
    reviewed: Record<string, string[]>;
}
/** Owner-only Host policy data. Project configuration cannot grant itself execution permission. */
export declare class PolicyStore {
    readonly directory: string;
    private path;
    private tail;
    constructor(options: Options);
    read(): Promise<PolicyDocument>;
    private atomic;
    private lock;
    update(expected: string, change: (document: PolicyDocument) => void, current: () => Promise<boolean>): Promise<PolicyDocument>;
    audit(data: Record<string, unknown>, current: () => Promise<boolean>): Promise<void>;
}
