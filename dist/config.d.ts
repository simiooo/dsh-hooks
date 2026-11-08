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
}
export interface Snapshot {
    hooks: Hook[];
    fingerprint: string;
    files: string[];
    diagnostics: string[];
}
declare const sha: (s: string) => string;
export { sha };
export declare function parseHooks(raw: unknown, source: string, env?: Record<string, string>, platform?: NodeJS.Platform): {
    hooks: Hook[];
    diagnostics: string[];
};
export declare function projectRoot(cwd: string): Promise<string>;
/** Content hashing rather than mtime detects atomic saves and same-size replacements. */
export declare function loadSnapshot(cwd: string, options?: Options): Promise<Snapshot>;
