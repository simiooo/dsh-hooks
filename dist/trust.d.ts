import { type Options } from './config.js';
export interface Grant {
    schema: 'dsh-hooks/trust-v1';
    id: string;
    cwd: string;
    fingerprint: string;
    policy: string;
    grantedAt: string;
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
}
