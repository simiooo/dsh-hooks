import { type Options } from './config.js';
export interface Grant {
    schema: 'dsh-hooks/trust-v1';
    id: string;
    cwd: string;
    fingerprint: string;
    policy: string;
    grantedAt: string;
}
interface OwnerDecision {
    cwd: string;
    sessionId: string;
    fingerprint: string;
    id: string;
    decision: string;
}
/** Independent records avoid losing another directory's grant during concurrent profile writes. */
export declare class PermanentTrust {
    private tail;
    private directory;
    constructor(options: Options);
    scope(cwd: string): Promise<string>;
    private path;
    get(cwd: string): Promise<Grant | undefined>;
    private serialize;
    remember(cwd: string, fingerprint: string, policy: string, current: () => Promise<boolean>): Promise<void>;
    forget(cwd: string): Promise<void>;
    /** Records the owner's explicit intent; only a matching live engine or durable grant can execute it. */
    recordDecision(request: OwnerDecision, current: () => Promise<boolean>): Promise<void>;
}
export {};
