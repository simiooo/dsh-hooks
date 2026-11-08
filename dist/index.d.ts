import { type Shell } from './engine.js';
import type { Options } from './config.js';
export { HooksEngine } from './engine.js';
export type { Options, Snapshot } from './config.js';
export type { PermissionRequest } from './engine.js';
export declare const name = "simiooo-hooks";
export declare const inject: string[];
type Block = {
    type: string;
    text?: string;
};
type Message = {
    id: string;
    role: 'user';
    content: Block[];
    source: {
        kind: string;
        event: string;
    };
};
interface Session {
    id: string;
    header: {
        id: string;
        cwd?: string;
        origin?: string;
        parentSession?: string;
    };
    snapshotEvents(): readonly SessionEvent[];
    append?(event: string, data: unknown, intent: {
        surfaceOp: 'append';
    }): unknown;
}
interface SessionEvent {
    type: string;
    data: any;
}
interface Agent {
    id: string;
    session: Session;
    options?: {
        model?: string;
    };
    inject(message: Message): void;
    steer(message: Message): void;
    cancel(cause: {
        kind: 'hook';
        reason: string;
    }, options?: {
        keepInbox: boolean;
    }): void;
}
interface Context {
    shell: Shell;
    approval: {
        request(request: {
            agent: Agent;
            toolName: string;
            reason: string;
            displayReason?: {
                en: string;
                zh: string;
            };
            signal: AbortSignal;
        }): Promise<string>;
    };
    workingDirectory: {
        defaultDirectory?: string;
        get?(session: Session): string;
        ensure(agent: Agent, signal: AbortSignal): Promise<string>;
    };
    logger: {
        warn(message: string): void;
    };
    on(event: string, callback: (...args: any[]) => any): () => void;
    inject(services: string[], callback: (ctx: any) => Promise<void>): unknown;
    effect(init: () => (() => void | Promise<void>), label?: string): unknown;
}
/** Mount with a standard Cordis bundle row. Hook commands always require human review. */
export declare function apply(ctx: Context, options?: Options): void;
