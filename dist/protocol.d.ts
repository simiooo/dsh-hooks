/** Release behavior baseline: https://learn.chatgpt.com/docs/hooks (2026-11-08). */
export declare const EVENTS: readonly ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "Interrupt", "SessionEnd"];
export type EventName = typeof EVENTS[number];
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export declare const object: (value: unknown) => value is Record<string, unknown>;
export interface Hook {
    event: EventName;
    command: string;
    matcher?: string;
    timeout?: number;
    async: boolean;
    statusMessage?: string;
    additionalContextLimit: number;
    source: string;
    env: Record<string, string>;
}
export interface Outcome {
    block: boolean;
    halt: boolean;
    context: string[];
    reason?: string;
    updatedInput?: Record<string, unknown>;
}
export declare const emptyOutcome: () => Outcome;
/** Match aliases affect matching only; payloads retain one canonical tool name. */
export declare function matches(hook: Hook, subjects: readonly string[]): boolean;
export declare function decode(event: EventName, exitCode: number | null, stdout: string, stderr: string): Outcome;
/** Stable config order chooses feedback; a halt always wins over Stop continuation. */
export declare function merge(outputs: Outcome[]): Outcome;
