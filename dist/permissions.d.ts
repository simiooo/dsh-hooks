/** Host-side human permission queue, exported only through Harness's authenticated Typert Gateway. */
export declare function installPermissionApi(ctx: any, revoke: (sessionId: string) => void): Promise<void>;
