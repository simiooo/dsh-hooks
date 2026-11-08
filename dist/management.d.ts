import { type Options, type Snapshot } from './config.js';
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
}
/** Host-only configuration management. Every write uses an observed revision and an enumerated source. */
export declare class HooksManagement {
    private options;
    private directories;
    private changed;
    private tail;
    private closed;
    constructor(options: Options, directories: () => string[], changed: () => Promise<void>);
    private scopes;
    private scope;
    private snapshot;
    private view;
    catalog(scopeId?: string): Promise<Catalog>;
    private check;
    private serialize;
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
