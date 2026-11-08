import type { PermissionRequest } from './engine.js';
export declare function isPermissionRequest(value: unknown): value is PermissionRequest;
/** Host-side human permission queue, exported only through Harness's authenticated Typert Gateway. */
interface PermissionActions {
    revoke(sessionId: string): void;
    remember(request: PermissionRequest, signal: AbortSignal): Promise<void>;
    status(sessionId: string): Promise<unknown>;
    forget(sessionId: string): Promise<void>;
}
export declare function installPermissionApi(ctx: any, actions: PermissionActions): Promise<void>;
export {};
