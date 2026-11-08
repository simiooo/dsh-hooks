/** Release behavior baseline: https://learn.chatgpt.com/docs/hooks (2026-11-08). */
export const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PreCompact', 'PostCompact', 'Stop', 'Interrupt', 'SessionEnd'];
export const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const emptyOutcome = () => ({ block: false, halt: false, context: [] });
/** Match aliases affect matching only; payloads retain one canonical tool name. */
export function matches(hook, subjects) {
    if (['Stop', 'UserPromptSubmit', 'Interrupt'].includes(hook.event))
        return true;
    if (!hook.matcher || hook.matcher === '*')
        return true;
    const pattern = new RegExp(hook.matcher);
    return subjects.some(subject => pattern.test(subject));
}
export function decode(event, exitCode, stdout, stderr) {
    const out = emptyOutcome();
    const gate = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'].includes(event);
    if (exitCode === 2 && gate)
        return { ...out, block: true, reason: stderr.trim() || `Blocked by ${event} hook` };
    if (exitCode !== 0)
        throw new Error(`hook exited ${exitCode ?? 'without an exit code'}: ${stderr.slice(0, 500)}`);
    const text = stdout.trim();
    if (!text)
        return out;
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        if (text.startsWith('{') || text.startsWith('['))
            throw new Error('malformed hook JSON');
        if (event === 'SessionStart' || event === 'UserPromptSubmit')
            return { ...out, context: [text] };
        if (['PreToolUse', 'PostToolUse', 'PreCompact', 'PostCompact', 'SessionEnd'].includes(event))
            return out;
        throw new Error(`${event} requires JSON output`);
    }
    if (!object(raw))
        throw new Error('hook output must be a JSON object');
    const specific = raw.hookSpecificOutput;
    if (specific !== undefined && (!object(specific) || specific.hookEventName !== event)) {
        throw new Error('hookSpecificOutput.hookEventName must match the event');
    }
    const h = object(specific) ? specific : {};
    if (raw.systemMessage !== undefined && typeof raw.systemMessage !== 'string')
        throw new Error('invalid systemMessage');
    if (raw.continue !== undefined && typeof raw.continue !== 'boolean')
        throw new Error('invalid continue');
    if (raw.stopReason !== undefined && typeof raw.stopReason !== 'string')
        throw new Error('invalid stopReason');
    if (raw.suppressOutput !== undefined && typeof raw.suppressOutput !== 'boolean')
        throw new Error('invalid suppressOutput');
    if (raw.decision !== undefined && raw.decision !== 'block' && raw.decision !== 'approve')
        throw new Error('invalid decision');
    if (raw.reason !== undefined && typeof raw.reason !== 'string')
        throw new Error('invalid reason');
    if (h.additionalContext !== undefined && typeof h.additionalContext !== 'string')
        throw new Error('invalid additionalContext');
    if (h.permissionDecisionReason !== undefined && typeof h.permissionDecisionReason !== 'string')
        throw new Error('invalid permissionDecisionReason');
    if (event === 'PreToolUse') {
        if (['continue', 'stopReason', 'suppressOutput'].some(k => k in raw) || raw.decision === 'approve' || h.permissionDecision === 'ask') {
            throw new Error('unsupported Codex PreToolUse control field');
        }
        if (h.permissionDecision !== undefined && !['allow', 'deny'].includes(String(h.permissionDecision)))
            throw new Error('invalid permissionDecision');
        if (h.updatedInput !== undefined) {
            if (h.permissionDecision !== 'allow' || !object(h.updatedInput))
                throw new Error('updatedInput requires allow and an object');
            out.updatedInput = h.updatedInput;
        }
        out.block = h.permissionDecision === 'deny' || raw.decision === 'block';
        if (typeof h.permissionDecisionReason === 'string')
            out.reason = h.permissionDecisionReason;
    }
    else if (event === 'PostToolUse') {
        if ('suppressOutput' in raw || 'updatedMCPToolOutput' in h || 'updatedMCPToolOutput' in raw)
            throw new Error('unsupported Codex PostToolUse control field');
        out.block = raw.decision === 'block';
        out.replace = raw.continue === false;
        if (typeof raw.stopReason === 'string')
            out.reason = raw.stopReason;
    }
    else if (gate) {
        out.block = raw.decision === 'block';
        out.halt = raw.continue === false;
        if (typeof raw.stopReason === 'string')
            out.reason = raw.stopReason;
    }
    else if (['SessionStart', 'PreCompact', 'PostCompact'].includes(event)) {
        out.halt = raw.continue === false;
        if (typeof raw.stopReason === 'string')
            out.reason = raw.stopReason;
    }
    if (typeof raw.reason === 'string' && out.reason === undefined)
        out.reason = raw.reason;
    if (typeof h.additionalContext === 'string' && ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'].includes(event))
        out.context.push(h.additionalContext);
    return out;
}
/** Stable config order chooses feedback; a halt always wins over Stop continuation. */
export function merge(outputs) {
    const merged = emptyOutcome();
    let feedbackPriority = 0;
    for (const out of outputs) {
        const priority = out.halt ? 3 : out.block ? 2 : out.replace ? 1 : 0;
        if (out.reason && priority > feedbackPriority) {
            merged.reason = out.reason;
            feedbackPriority = priority;
        }
        merged.block ||= out.block;
        merged.halt ||= out.halt;
        if (out.replace)
            merged.replace = true;
        merged.context.push(...out.context);
        if (out.updatedInput)
            merged.updatedInput = out.updatedInput;
    }
    return merged;
}
//# sourceMappingURL=protocol.js.map