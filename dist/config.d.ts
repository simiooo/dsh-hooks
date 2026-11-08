import { type Hook } from './protocol.js';
export interface Options {
    configPaths?: string[];
    codexHome?: string;
    discover?: boolean;
    pluginRoots?: string[];
    watchPaths?: string[];
    pollIntervalMs?: number;
    defaultTimeoutMs?: number;
    permissionTimeoutMs?: number;
    maxStopContinuations?: number;
    maxOutputBytes?: number;
    /** Set posix for a POSIX/SSH executor hosted by Windows. Auto uses the host platform. */
    shellFlavor?: 'auto' | 'powershell' | 'posix';
    pluginDataRoot?: string;
    /** Host-local persistent switches; Codex source files keep their original format. */
    controlsPath?: string;
    /** Host-local durable grants, one atomic record per canonical working directory. */
    permissionsDir?: string;
}
export interface HookView {
    id: string;
    event: string;
    name: string;
    command: string;
    timeout: number;
    async: boolean;
    matcher?: string;
    enabled: boolean;
    supported: boolean;
    problem?: string;
}
export interface HookSource {
    id: string;
    path: string;
    kind: 'user' | 'project' | 'plugin' | 'custom';
    hooks: HookView[];
    issues: string[];
    errors: string[];
    missing?: boolean;
}
export interface Snapshot {
    hooks: Hook[];
    fingerprint: string;
    files: string[];
    diagnostics: string[];
    sources: HookSource[];
    disabled: string[];
}
declare const sha: (s: string) => string;
export { sha };
export declare const controlsPath: (options: Options) => string;
export declare function parseHooks(raw: unknown, source: string, env?: Record<string, string>, platform?: NodeJS.Platform, namespace?: string): {
    hooks: Hook[];
    diagnostics: string[];
};
export declare function projectRoot(cwd: string): Promise<string>;
/** Content hashing rather than mtime detects atomic saves and same-size replacements. */
export declare function loadSnapshot(cwd: string, options?: Options, inspect?: boolean, overrides?: ReadonlyMap<string, string>): Promise<Snapshot>;
