import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadSnapshot, sha } from './config.js';
import { decode, emptyOutcome, matches, merge } from './protocol.js';
/** Protocol engine; every process uses the Harness shell, including remote/sandbox executors. */
export class HooksEngine {
    shell;
    authorize;
    options;
    log;
    sessions = new Map();
    lifetime = new AbortController();
    interval;
    constructor(shell, authorize, options = {}, log = () => { }) {
        this.shell = shell;
        this.authorize = authorize;
        this.options = options;
        this.log = log;
        for (const [key, value] of Object.entries(options)) {
            if (['pollIntervalMs', 'defaultTimeoutMs', 'permissionTimeoutMs', 'maxStopContinuations', 'maxOutputBytes'].includes(key)
                && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647))
                throw new TypeError(`${key} must be a positive timer-safe integer`);
        }
        if (options.shellFlavor !== undefined && !['auto', 'posix', 'powershell'].includes(options.shellFlavor))
            throw new TypeError('invalid shellFlavor');
    }
    start() {
        if (this.interval)
            return;
        this.interval = setInterval(() => {
            for (const [id] of this.sessions)
                void this.refresh(id).catch(() => { });
        }, this.options.pollIntervalMs ?? 1000);
        this.interval.unref();
    }
    attach(id, cwd) {
        const old = this.sessions.get(id);
        if (old) {
            if (old.cwd !== cwd) {
                old.cwd = cwd;
                old.approved = undefined;
                old.revision.abort();
                old.revision = new AbortController();
            }
            return;
        }
        if (this.lifetime.signal.aborted)
            throw new Error('hooks engine disposed');
        this.sessions.set(id, { cwd, revision: new AbortController(), active: new Set(), queued: [], background: 0, contexts: [] });
    }
    state(id) {
        const state = this.sessions.get(id);
        if (!state)
            throw new Error(`hooks session not attached: ${id}`);
        return state;
    }
    async refresh(id) {
        const state = this.state(id);
        if (state.refresh)
            return state.refresh;
        const work = (async () => {
            try {
                const snapshot = await loadSnapshot(state.cwd, this.options);
                const changed = state.snapshot?.fingerprint !== snapshot.fingerprint || state.error !== undefined;
                if (changed) {
                    state.revision.abort(new Error('hooks configuration or script changed'));
                    state.revision = new AbortController();
                    state.approved = undefined;
                    state.contexts.length = 0;
                    state.queued.length = 0;
                    state.snapshot = snapshot;
                    this.log(`Hooks reloaded: ${snapshot.hooks.length} handlers (${snapshot.fingerprint.slice(0, 12)})`);
                    snapshot.diagnostics.forEach(this.log);
                }
                delete state.error;
                return snapshot;
            }
            catch (error) {
                const message = error instanceof Error ? error : new Error(String(error));
                if (state.error?.message !== message.message)
                    this.log(`Hooks configuration rejected: ${message.message}`);
                state.error = message;
                state.approved = undefined;
                state.contexts.length = 0;
                state.revision.abort(message);
                throw message;
            }
        })();
        state.refresh = work;
        try {
            return await work;
        }
        finally {
            delete state.refresh;
        }
    }
    async permitted(id, snapshot, signal, approvedOnly) {
        const state = this.state(id);
        if (state.approved === snapshot.fingerprint)
            return true;
        if (approvedOnly || signal.aborted)
            return false;
        // One human review for the complete immutable configuration, even when tool calls overlap.
        if (state.pendingApproval) {
            await state.pendingApproval;
            return state.approved === snapshot.fingerprint && !signal.aborted;
        }
        const request = {
            schema: 'dsh-hooks/approval-v1', sessionId: id, cwd: state.cwd, fingerprint: snapshot.fingerprint, scope: 'session',
            hooks: snapshot.hooks.map(({ event, command, source, statusMessage }) => ({ event, command, source, ...(statusMessage ? { statusMessage } : {}) })),
        };
        const approvalSignal = AbortSignal.any([signal, AbortSignal.timeout(this.options.permissionTimeoutMs ?? 120_000)]);
        const pending = (async () => {
            try {
                const allowed = await this.authorize(request, approvalSignal);
                if (!allowed || approvalSignal.aborted)
                    return false;
                const current = await this.refresh(id);
                if (current.fingerprint !== snapshot.fingerprint || signal.aborted)
                    return false;
                state.approved = snapshot.fingerprint;
                return true;
            }
            catch (error) {
                this.log(`Hook permission unavailable: ${String(error)}`);
                return false;
            }
        })();
        state.pendingApproval = pending;
        try {
            return await pending;
        }
        finally {
            delete state.pendingApproval;
        }
    }
    revoke(id) {
        const state = this.sessions.get(id);
        if (!state)
            return;
        state.approved = undefined;
        this.stopWork(id);
    }
    stopWork(id) {
        const state = this.sessions.get(id);
        if (!state)
            return;
        state.revision.abort(new Error('hook permission revoked'));
        state.revision = new AbortController();
        state.queued.length = 0;
    }
    takeContexts(id) { return this.state(id).contexts.splice(0); }
    async run(id, event, payload, subjects, signal, approvedOnly = false) {
        const state = this.state(id);
        let snapshot;
        try {
            snapshot = await this.refresh(id);
        }
        catch {
            return { ...emptyOutcome(), block: true, halt: true, reason: 'Hooks configuration is invalid; fix the file before continuing.' };
        }
        const hooks = snapshot.hooks.filter(hook => hook.event === event && matches(hook, subjects));
        if (!hooks.length)
            return emptyOutcome();
        const ownerSignal = AbortSignal.any([signal, this.lifetime.signal, state.revision.signal]);
        if (!await this.permitted(id, snapshot, ownerSignal, approvedOnly)) {
            this.log(`Hooks ${event}: current version has no human approval`);
            return { ...emptyOutcome(), block: true, halt: event === 'SessionStart', reason: 'Hook execution was not approved.' };
        }
        // Fresh read after human review closes the known edit-during-approval window.
        const stale = () => ({ ...emptyOutcome(), block: true, halt: event === 'SessionStart', reason: 'Hooks changed during execution; retry to review the current version.' });
        if ((await this.refresh(id)).fingerprint !== snapshot.fingerprint || ownerSignal.aborted)
            return stale();
        const execute = async (hook, background) => {
            try {
                ownerSignal.throwIfAborted();
                if (hook.statusMessage)
                    this.log(hook.statusMessage);
                if (hook.env.PLUGIN_DATA)
                    await mkdir(hook.env.PLUGIN_DATA, { recursive: true, mode: 0o700 });
                let timeoutMs = (hook.timeout ?? (this.options.defaultTimeoutMs ?? 600_000) / 1000) * 1000;
                if (event === 'SessionEnd' || event === 'Interrupt')
                    timeoutMs = Math.min(3000, Math.max(1000, (hook.timeout ?? 1) * 1000));
                const execution = await this.shell.execute(this.shell.resolve({
                    command: this.command(hook.command), workdir: state.cwd, stdin: JSON.stringify(payload), env: hook.env,
                    timeoutMs, stdoutMaxBytes: this.options.maxOutputBytes ?? 1_048_576,
                    signal: background ? AbortSignal.any([this.lifetime.signal, state.revision.signal]) : ownerSignal,
                }));
                const result = await execution.result();
                if (result.timedOut || result.aborted || result.stdout.truncated)
                    throw new Error(`hook incomplete: timedOut=${!!result.timedOut}, aborted=${!!result.aborted}, truncated=${!!result.stdout.truncated}`);
                if (ownerSignal.aborted || state.snapshot?.fingerprint !== snapshot.fingerprint)
                    return background ? emptyOutcome() : stale();
                const out = decode(event, result.exitCode, result.stdout.text, result.stderr.text);
                try {
                    const raw = JSON.parse(result.stdout.text);
                    if (typeof raw === 'object' && raw && 'systemMessage' in raw && typeof raw.systemMessage === 'string')
                        this.log(raw.systemMessage);
                }
                catch { /* Plain text is valid on context-producing events. */ }
                out.context = await Promise.all(out.context.map(text => this.limitContext(id, text, hook.additionalContextLimit)));
                if (background) {
                    state.contexts.push(...out.context);
                    return emptyOutcome();
                }
                return out;
            }
            catch (error) {
                this.log(`${event} hook failed (${hook.source}): ${String(error)}`);
                if (!background && (state.snapshot?.fingerprint !== snapshot.fingerprint || (ownerSignal.aborted && !signal.aborted)))
                    return stale();
                return emptyOutcome(); // Codex process/parse failures are nonblocking.
            }
        };
        // Every matching handler starts independently. Return order is configuration order.
        return merge(await Promise.all(hooks.map(hook => {
            if (!hook.async)
                return this.track(state, execute(hook, false));
            this.enqueue(state, () => this.track(state, execute(hook, true)));
            return Promise.resolve(emptyOutcome());
        })));
    }
    command(command) {
        const powershell = this.options.shellFlavor === 'powershell' || ((this.options.shellFlavor ?? 'auto') === 'auto' && process.platform === 'win32');
        if (!powershell)
            return command;
        const expanded = command.replace(/\$\{(PLUGIN_ROOT|PLUGIN_DATA|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)\}/g, (_match, key) => `$env:${key}`);
        // PowerShell -Command normally collapses a native exit 2 to 1. Preserve the hook protocol.
        return `$global:LASTEXITCODE = 0\n& {\n${expanded}\n}\n$dshHooksSucceeded = $?\nif (-not $dshHooksSucceeded -and $LASTEXITCODE -eq 0) { exit 1 }\nexit $LASTEXITCODE`;
    }
    track(state, promise) {
        state.active.add(promise);
        void promise.then(() => state.active.delete(promise), () => state.active.delete(promise));
        return promise;
    }
    enqueue(state, task) {
        if (state.queued.length >= 256) {
            this.log('Hook background queue is full; invocation skipped');
            return;
        }
        const start = () => {
            if (state.revision.signal.aborted || this.lifetime.signal.aborted)
                return;
            state.background++;
            void task().finally(() => { state.background--; state.queued.shift()?.(); });
        };
        if (state.background < 8)
            start();
        else
            state.queued.push(start);
    }
    async limitContext(id, text, tokens) {
        if (tokens === 0 || text.length <= tokens * 4)
            return text;
        const cap = tokens * 4;
        let saved = '';
        try {
            const dir = join(tmpdir(), 'dsh-hooks', sha(id).slice(0, 24));
            await mkdir(dir, { recursive: true, mode: 0o700 });
            const file = join(dir, `${randomUUID()}.txt`);
            await writeFile(file, text, { mode: 0o600, flag: 'wx' });
            saved = ` Full output: ${file}`;
        }
        catch {
            this.log('Could not save oversized hook context');
        }
        return `${text.slice(0, Math.ceil(cap / 2))}\n[Hook context truncated.${saved}]\n${text.slice(-Math.floor(cap / 2))}`;
    }
    async detach(id) {
        const state = this.sessions.get(id);
        if (!state)
            return;
        state.revision.abort(new Error('session ended'));
        state.queued.length = 0;
        await Promise.allSettled([...state.active, ...state.refresh ? [state.refresh] : [], ...state.pendingApproval ? [state.pendingApproval] : []]);
        this.sessions.delete(id);
    }
    async dispose() {
        if (this.interval)
            clearInterval(this.interval);
        this.interval = undefined;
        this.lifetime.abort(new Error('hooks plugin disposed'));
        await Promise.allSettled([...this.sessions.keys()].map(id => this.detach(id)));
    }
}
//# sourceMappingURL=engine.js.map