import { type Options, type Snapshot } from './config.js';
import type { HooksEngine } from './engine.js';
import type { PermissionChoice } from './policy.js';
export interface Scope {
    id: string;
    cwd: string;
}
export interface Catalog {
    revision: string;
    scopeId: string;
    scopes: Scope[];
    sources: Snapshot['sources'];
    issues: string[];
    permissions?: Awaited<ReturnType<HooksEngine['policyCatalog']>>;
    permissionProblem?: string;
}
/** Host-only configuration management. Every write uses an observed revision and an enumerated source. */
export declare class HooksManagement {
    private options;
    private directories;
    private changed;
    private permissions?;
    private tail;
    private closed;
    constructor(options: Options, directories: () => string[], changed: () => Promise<void>, permissions?: HooksEngine | undefined);
    private scopes;
    private scope;
    private snapshot;
    private view;
    catalog(scopeId?: string): Promise<Catalog>;
    private check;
    private serialize;
    private current;
    setPermission(scopeId: string, revision: string, policyRevision: string, id: string, scope: 'global' | 'project', choice: PermissionChoice): Promise<Catalog>;
    setDefaultPermission(scopeId: string, revision: string, policyRevision: string, enabled: boolean): Promise<Catalog>;
    setEnabled(scopeId: string, revision: string, id: string, enabled: boolean): Promise<Catalog>;
    readSource(scopeId: string, revision: string, sourceId: string): Promise<{
        path: string;
        content: string;
        revision: string;
        format: string;
    }>;
    writeSource(scopeId: string, revision: string, sourceId: string, content: string): Promise<Catalog>;
    private atomicWrite;
    dispose(): Promise<void>;
}
