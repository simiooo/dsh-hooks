import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadSnapshot, sha, type Options, type Snapshot } from './config.js';
import { decode, emptyOutcome, matches, merge, type EventName, type Hook, type Outcome } from './protocol.js';
import { PermanentTrust } from './trust.js';

export interface ShellResult {
  exitCode: number | null; timedOut?: boolean; aborted?: boolean;
  stdout: { text: string; truncated?: boolean }; stderr: { text: string; truncated?: boolean };
}
export interface Shell {
  resolve(request: Record<string, unknown>): unknown;
  execute(spec: unknown): Promise<{ result(): Promise<ShellResult> }>;
}
export interface PermissionRequest {
  schema: 'dsh-hooks/approval-v1'; sessionId: string; cwd: string; fingerprint: string;
  scope: 'session'; hooks: { event: EventName; command: string; source: string; statusMessage?: string }[];
}
export type Authorize = (request: PermissionRequest, signal: AbortSignal) => Promise<boolean | 'deferred'>;
export type HookDecision = 'allow-session' | 'allow-permanent' | 'deny';
export interface ManualAnswer { sessionId: string; id: string; fingerprint: string; decision: HookDecision }
interface ManualReview { id: string; epoch: number; fingerprint: string; busy: boolean }
interface PendingApproval {
  revision: number; controller: AbortController; promise: Promise<boolean>; waiters: number; settled: boolean;
}
interface SessionState {
  cwd: string; snapshot?: Snapshot; error?: Error; revision: AbortController; epoch: number;
  life: AbortController; closed: boolean; draining?: Promise<void>;
  approved?: number | undefined; permanent?: boolean; ignorePermanent?: boolean; refresh?: Promise<Snapshot>; pending?: PendingApproval;
  manual?: ManualReview;
  active: Set<Promise<unknown>>; queued: (() => void)[]; background: number;
  contexts: { revision: number; text: string }[];
}
interface Revision { epoch: number; cwd: string; snapshot: Snapshot; signal: AbortSignal }

/** Join cancellation independently of whether a provider observes its signal. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('cancelled')); };
    if (signal.aborted) { void promise.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
const unavailable = (event: EventName, reason: string): Outcome => ({ ...emptyOutcome(), deferred: true, block: true, halt: event === 'SessionStart', reason });

/** Protocol engine; processes use the Harness shell and immutable session/revision lifetimes. */
export class HooksEngine {
  private sessions = new Map<string, SessionState>();
  private lifetime = new AbortController();
  private interval: ReturnType<typeof setInterval> | undefined;
  private disposal: Promise<void> | undefined;
  readonly options: Readonly<Options>;
  private trust: PermanentTrust;
  constructor(private shell: Shell, private authorize: Authorize, options: Options = {}, private log: (message: string) => void = () => {}) {
    const copy = structuredClone(options);
    for (const [key, value] of Object.entries(copy)) {
      if (['pollIntervalMs', 'defaultTimeoutMs', 'permissionTimeoutMs', 'maxStopContinuations', 'maxOutputBytes'].includes(key)
        && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)) throw new TypeError(`${key} must be a positive timer-safe integer`);
      if (['configPaths', 'pluginRoots', 'watchPaths'].includes(key)) {
        if (!Array.isArray(value) || value.some(path => typeof path !== 'string' || !path.trim())) throw new TypeError(`${key} must contain nonempty paths`);
        Object.freeze(value);
      }
    }
    if (copy.shellFlavor !== undefined && !['auto', 'posix', 'powershell'].includes(copy.shellFlavor)) throw new TypeError('invalid shellFlavor');
    this.options = Object.freeze(copy);
    this.trust = new PermanentTrust(this.options);
  }
  start(): void {
    if (this.lifetime.signal.aborted) throw new Error('hooks engine disposed');
    if (this.interval) return;
    this.interval = setInterval(() => {
      for (const [id, state] of this.sessions) if (!state.closed) void this.refresh(id).catch(() => {});
    }, this.options.pollIntervalMs ?? 1000);
    this.interval.unref();
  }
  attach(id: string, cwd: string): void {
    if (this.lifetime.signal.aborted) throw new Error('hooks engine disposed');
    const old = this.sessions.get(id);
    if (old && !old.closed) {
      if (old.cwd !== cwd) { old.cwd = cwd; this.invalidate(old, 'session directory changed'); }
      return;
    }
    this.sessions.set(id, { cwd, revision: new AbortController(), epoch: 0, life: new AbortController(), closed: false, active: new Set(), queued: [], background: 0, contexts: [] });
  }
  private state(id: string): SessionState {
    const state = this.sessions.get(id); if (!state) throw new Error(`hooks session not attached: ${id}`); return state;
  }
  private invalidate(state: SessionState, reason: string): void {
    state.epoch++; state.approved = undefined; state.permanent = false; state.contexts.length = 0; state.queued.length = 0;
    delete state.manual;
    state.revision.abort(new Error(reason)); state.pending?.controller.abort(new Error(reason));
    state.revision = new AbortController();
  }
  async refresh(id: string): Promise<Snapshot> {
    const state = this.state(id);
    if (state.closed) throw new Error('hooks session ended');
    if (state.refresh) return state.refresh;
    const work = (async () => {
      for (;;) {
        const cwd = state.cwd;
        try {
          const snapshot = await loadSnapshot(cwd, this.options);
          if (state.closed) throw new Error('hooks session ended');
          if (cwd !== state.cwd) continue; // A read started in the old directory cannot publish its snapshot.
          if (state.snapshot?.fingerprint !== snapshot.fingerprint || state.error !== undefined) {
            this.invalidate(state, 'hooks configuration or script changed'); state.snapshot = snapshot;
            this.log(`Hooks reloaded: ${snapshot.hooks.length} handlers (${snapshot.fingerprint.slice(0, 12)})`);
            snapshot.diagnostics.forEach(this.log);
          }
          delete state.error;
          if (state.permanent && !await this.trusted(cwd, snapshot)) this.invalidate(state, 'permanent hook permission revoked');
          return state.snapshot!;
        } catch (error) {
          if (state.closed) throw error;
          if (cwd !== state.cwd) continue;
          const message = error instanceof Error ? error : new Error(String(error));
          if (state.error?.message !== message.message) this.log(`Hooks configuration rejected: ${message.message}`);
          state.error = message; this.invalidate(state, message.message); throw message;
        }
      }
    })();
    state.refresh = work;
    try { return await work; } finally { if (state.refresh === work) delete state.refresh; }
  }
  private valid(state: SessionState, revision: Revision): boolean {
    return !state.closed && !this.lifetime.signal.aborted && state.epoch === revision.epoch && state.cwd === revision.cwd && !revision.signal.aborted;
  }
  private async permitted(id: string, state: SessionState, revision: Revision, signal: AbortSignal, approvedOnly: boolean): Promise<boolean> {
    if (!this.valid(state, revision) || signal.aborted) return false;
    if (state.approved === revision.epoch && !state.permanent) return true;
    if (!state.ignorePermanent && await this.trusted(revision.cwd, revision.snapshot)) {
      if (!this.valid(state, revision) || signal.aborted) return false;
      state.approved = revision.epoch; state.permanent = true; return true;
    }
    if (!this.valid(state, revision) || signal.aborted) return false;
    if (approvedOnly) return false;
    let pending = state.pending;
    if (!pending || pending.revision !== revision.epoch || pending.controller.signal.aborted) {
      const request: PermissionRequest = {
        schema: 'dsh-hooks/approval-v1', sessionId: id, cwd: revision.cwd, fingerprint: revision.snapshot.fingerprint, scope: 'session',
        hooks: revision.snapshot.hooks.map(({ event, command, source, statusMessage }) => ({ event, command, source, ...(statusMessage ? { statusMessage } : {}) })),
      };
      const controller = new AbortController();
      const approvalSignal = AbortSignal.any([controller.signal, state.life.signal, revision.signal, this.lifetime.signal]);
      const entry: PendingApproval = { revision: revision.epoch, controller, promise: Promise.resolve(false), waiters: 0, settled: false };
      state.pending = entry;
      const timeout = setTimeout(() => controller.abort(new Error('hook permission timed out')), this.options.permissionTimeoutMs ?? 120_000);
      entry.promise = (async () => {
        try {
          const allowed = await abortable(Promise.resolve().then(() => { approvalSignal.throwIfAborted(); return this.authorize(request, approvalSignal); }), approvalSignal);
          if (allowed === false && !approvalSignal.aborted && this.valid(state, revision)) state.ignorePermanent = true;
          if (allowed !== true || approvalSignal.aborted || !this.valid(state, revision)) return false;
          await abortable(this.refresh(id), approvalSignal);
          if (approvalSignal.aborted || !this.valid(state, revision)) return false;
          state.approved = revision.epoch; state.permanent = !state.ignorePermanent && await this.trusted(revision.cwd, revision.snapshot); return true;
        } catch (error) {
          if (!approvalSignal.aborted) this.log(`Hook permission unavailable: ${String(error)}`);
          return false;
        } finally {
          clearTimeout(timeout); entry.settled = true;
          if (state.pending === entry) delete state.pending;
        }
      })();
      pending = entry;
    }
    pending.waiters++;
    try { return await abortable(pending.promise, signal) && this.valid(state, revision) && !signal.aborted; }
    catch { return false; }
    finally {
      pending.waiters--;
      if (!pending.waiters && !pending.settled) pending.controller.abort(new Error('no active hook permission waiters'));
    }
  }
  revoke(id: string): void { const state = this.sessions.get(id); if (state && !state.closed) { state.ignorePermanent = true; this.invalidate(state, 'hook permission revoked'); } }
  private policy(snapshot: Snapshot): string {
    return sha(JSON.stringify([snapshot.fingerprint, snapshot.hooks, this.options.shellFlavor ?? process.platform,
      this.options.defaultTimeoutMs ?? 600_000, this.options.maxOutputBytes ?? 1_048_576]));
  }
  private async trusted(cwd: string, snapshot: Snapshot): Promise<boolean> {
    try { const grant = await this.trust.get(cwd); return !!grant && grant.fingerprint === snapshot.fingerprint && grant.policy === this.policy(snapshot); }
    catch { return false; } // Corrupt/unreadable storage never grants executable-code access.
  }
  async remember(request: PermissionRequest, signal: AbortSignal): Promise<void> {
    const state = this.state(request.sessionId), epoch = state.epoch;
    const current = async () => {
      if (signal.aborted || state.closed || this.lifetime.signal.aborted || state.epoch !== epoch || state.cwd !== request.cwd) return false;
      const snapshot = await this.refresh(request.sessionId);
      return !signal.aborted && !state.closed && !this.lifetime.signal.aborted && state.epoch === epoch && snapshot.fingerprint === request.fingerprint;
    };
    if (!await current()) throw new Error('Hooks changed. Review again.');
    await this.trust.remember(state.cwd, request.fingerprint, this.policy(state.snapshot!), current);
    state.ignorePermanent = false;
  }
  async permissionStatus(id: string) {
    const state = this.sessions.get(id);
    if (!state || state.closed) return { session: false, permanent: false };
    try {
      const snapshot = await this.refresh(id);
      const hooks = snapshot.hooks.map(({ event, command, source, statusMessage }) => ({ event, command, source, ...(statusMessage ? { statusMessage } : {}) }));
      const epoch = state.epoch, permanent = await this.trusted(state.cwd, snapshot);
      if (state.closed || state.snapshot !== snapshot || state.epoch !== epoch) return { session: false, permanent: false };
      if (permanent && !state.ignorePermanent) { state.approved = epoch; state.permanent = true; }
      const session = state.approved === state.epoch;
      if (!session && hooks.length && !state.manual) state.manual = { id: `manual:${randomUUID()}`, epoch: state.epoch, fingerprint: snapshot.fingerprint, busy: false };
      const review = !session && state.manual ? { schema: 'dsh-hooks/approval-v1' as const, scope: 'session' as const, sessionId: id, cwd: state.cwd,
        fingerprint: snapshot.fingerprint, hooks, id: state.manual.id, manual: true as const } : undefined;
      return { cwd: state.cwd, session, permanent, fingerprint: snapshot.fingerprint, hooks, ...(review ? { review } : {}) };
    } catch (error) { return { cwd: state.cwd, session: false, permanent: false, problem: String(error) }; }
  }
  async answerManual(request: ManualAnswer): Promise<boolean> {
    const state = this.sessions.get(request.sessionId), review = state?.manual;
    if (!state || !review || review.id !== request.id || review.fingerprint !== request.fingerprint || !['allow-session', 'allow-permanent', 'deny'].includes(request.decision)) return false;
    if (review.busy) throw new Error('Hook review is already being saved. Try again.');
    const epoch = review.epoch, signal = AbortSignal.any([state.revision.signal, state.life.signal, this.lifetime.signal]);
    const current = async () => {
      if (signal.aborted || state.closed || state.manual !== review || state.epoch !== epoch) return false;
      const snapshot = await this.refresh(request.sessionId);
      return !signal.aborted && !state.closed && state.manual === review && state.epoch === epoch && snapshot.fingerprint === request.fingerprint;
    };
    review.busy = true;
    try {
      if (!await current()) return false;
      const snapshot = state.snapshot!, cwd = state.cwd;
      await this.trust.recordDecision({ ...request, cwd }, current);
      if (!await current()) return false;
      if (request.decision === 'deny') this.revoke(request.sessionId);
      else {
        if (request.decision === 'allow-permanent') await this.remember({ schema: 'dsh-hooks/approval-v1', scope: 'session', sessionId: request.sessionId, cwd, fingerprint: snapshot.fingerprint, hooks: [] }, signal);
        if (!await current()) return false;
        state.approved = epoch; state.permanent = request.decision === 'allow-permanent';
        if (state.manual === review) delete state.manual;
      }
      return true;
    } finally { review.busy = false; }
  }
  async forget(id: string): Promise<void> {
    const state = this.state(id), cwd = await this.trust.scope(state.cwd);
    // Withdraw requests and active work before touching disk; a stale pending answer cannot re-grant.
    for (const other of this.sessions.values()) {
      if (!other.closed && await this.trust.scope(other.cwd).catch(() => '') === cwd) this.invalidate(other, 'permanent hook permission revoked');
    }
    await this.trust.forget(state.cwd);
  }
  stopWork(id: string): void {
    const state = this.sessions.get(id); if (!state || state.closed) return;
    const approved = state.approved === state.epoch, permanent = state.permanent;
    this.invalidate(state, 'session work stopped');
    if (approved) { state.approved = state.epoch; state.permanent = !!permanent; } // Cleanup may reuse a reviewed, unchanged configuration.
  }
  retainContexts(id: string, outcome: Outcome): void {
    const state = this.state(id);
    if (!state.closed && !outcome.deferred && outcome.revision === state.epoch) state.contexts.push(...outcome.context.map(text => ({ revision: state.epoch, text })));
  }
  takeContexts(id: string): string[] {
    const state = this.state(id);
    return state.contexts.splice(0).filter(item => !state.closed && item.revision === state.epoch).map(item => item.text);
  }
  run(id: string, event: EventName, payload: Record<string, unknown>, subjects: readonly string[], signal: AbortSignal, approvedOnly = false): Promise<Outcome> {
    const state = this.state(id);
    if (state.closed) return Promise.resolve(unavailable(event, 'Hooks session has ended.'));
    return this.track(state, this.runPoint(id, state, event, payload, subjects, signal, approvedOnly));
  }
  private async runPoint(id: string, state: SessionState, event: EventName, payload: Record<string, unknown>, subjects: readonly string[], signal: AbortSignal, approvedOnly: boolean): Promise<Outcome> {
    const cwd = state.cwd;
    let snapshot: Snapshot;
    const operationSignal = AbortSignal.any([signal, state.life.signal, this.lifetime.signal]);
    try { snapshot = await abortable(this.refresh(id), operationSignal); }
    catch { return unavailable(event, 'Hooks configuration is unavailable; fix the file before continuing.'); }
    const revision: Revision = { cwd, snapshot, epoch: state.epoch, signal: state.revision.signal };
    const ownerSignal = AbortSignal.any([signal, revision.signal, state.life.signal, this.lifetime.signal]);
    const stale = () => unavailable(event, 'Hooks changed or were cancelled; retry to review the current version.');
    if (!this.valid(state, revision) || ownerSignal.aborted) return stale();
    const hooks = snapshot.hooks.filter(hook => hook.event === event && matches(hook, subjects));
    // Review compact-only configurations during an ordinary open turn, where native approval audit is legal.
    // PreCompact also reviews PostCompact up front, before any compression takes place.
    const compactReview = ['SessionStart', 'UserPromptSubmit', 'PreCompact'].includes(event)
      && snapshot.hooks.some(hook => hook.event === 'PreCompact' || hook.event === 'PostCompact');
    if (!hooks.length && !compactReview) return { ...emptyOutcome(), revision: revision.epoch };
    if (!await this.permitted(id, state, revision, ownerSignal, approvedOnly)) return unavailable(event, 'Hook execution was not approved.');
    try { await abortable(this.refresh(id), ownerSignal); } catch { return unavailable(event, 'Hooks configuration became unavailable during review.'); }
    if (!this.valid(state, revision) || ownerSignal.aborted) return stale();
    const execute = async (hook: Hook, background: boolean): Promise<Outcome> => {
      const executionSignal = background ? AbortSignal.any([revision.signal, state.life.signal, this.lifetime.signal]) : ownerSignal;
      try {
        executionSignal.throwIfAborted(); if (!this.valid(state, revision)) return stale();
        if (hook.statusMessage) this.log(hook.statusMessage);
        if (hook.env.PLUGIN_DATA) await mkdir(hook.env.PLUGIN_DATA, { recursive: true, mode: 0o700 });
        executionSignal.throwIfAborted();
        let timeoutMs = (hook.timeout ?? (this.options.defaultTimeoutMs ?? 600_000) / 1000) * 1000;
        if (event === 'SessionEnd' || event === 'Interrupt') timeoutMs = Math.min(3000, Math.max(1000, (hook.timeout ?? 1) * 1000));
        timeoutMs = Math.max(1, Math.ceil(timeoutMs));
        const spec = this.shell.resolve({ command: this.command(hook.command), workdir: revision.cwd, stdin: JSON.stringify(payload), env: hook.env,
          timeoutMs, stdoutMaxBytes: this.options.maxOutputBytes ?? 1_048_576, signal: executionSignal });
        executionSignal.throwIfAborted();
        const execution = await this.shell.execute(spec);
        const result = await execution.result();
        if (result.timedOut || result.aborted || result.stdout.truncated) throw new Error(`hook incomplete: timedOut=${!!result.timedOut}, aborted=${!!result.aborted}, truncated=${!!result.stdout.truncated}`);
        if (!this.valid(state, revision) || executionSignal.aborted) return background ? emptyOutcome() : stale();
        const out = decode(event, result.exitCode, result.stdout.text, result.stderr.text);
        try {
          const raw: unknown = JSON.parse(result.stdout.text);
          if (typeof raw === 'object' && raw && 'systemMessage' in raw && typeof raw.systemMessage === 'string') this.log(raw.systemMessage);
        } catch { /* Plain stdout is accepted only by the event-specific decoder. */ }
        out.context = await Promise.all(out.context.map(text => this.limitContext(id, text, hook.additionalContextLimit)));
        // Spilling is asynchronous too: a revoke during the write must not publish old output.
        if (!this.valid(state, revision) || executionSignal.aborted) return background ? emptyOutcome() : stale();
        if (background) {
          state.contexts.push(...out.context.map(text => ({ revision: revision.epoch, text })));
          return emptyOutcome();
        }
        return out;
      } catch (error) {
        this.log(`${event} hook failed (${hook.source}): ${String(error)}`);
        if (!background && (!this.valid(state, revision) || ownerSignal.aborted)) return stale();
        return emptyOutcome(); // Process, timeout and parse failures follow Codex's nonblocking policy.
      }
    };
    const out = merge(await Promise.all(hooks.map(hook => {
      if (!hook.async) return execute(hook, false);
      this.enqueue(state, revision, () => execute(hook, true));
      return Promise.resolve(emptyOutcome());
    })));
    if (!this.valid(state, revision) || ownerSignal.aborted) return stale();
    return { ...out, revision: revision.epoch };
  }
  private command(command: string): string {
    const powershell = this.options.shellFlavor === 'powershell' || ((this.options.shellFlavor ?? 'auto') === 'auto' && process.platform === 'win32');
    if (!powershell) return command;
    const expanded = command.replace(/\$\{(PLUGIN_ROOT|PLUGIN_DATA|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)\}/g, (_match, key: string) => `$env:${key}`);
    return `$global:LASTEXITCODE = 0\n& {\n${expanded}\n}\n$dshHooksSucceeded = $?\nif (-not $dshHooksSucceeded -and $LASTEXITCODE -eq 0) { exit 1 }\nexit $LASTEXITCODE`;
  }
  private track<T>(state: SessionState, promise: Promise<T>): Promise<T> {
    state.active.add(promise); void promise.then(() => state.active.delete(promise), () => state.active.delete(promise)); return promise;
  }
  private enqueue(state: SessionState, revision: Revision, task: () => Promise<Outcome>): void {
    if (state.queued.length >= 256) { this.log('Hook background queue is full; invocation skipped'); return; }
    const start = () => {
      if (!this.valid(state, revision)) return;
      state.background++;
      const settled = () => { state.background--; state.queued.shift()?.(); };
      void this.track(state, task()).then(settled, settled);
    };
    if (state.background < 8) start(); else state.queued.push(start);
  }
  private async limitContext(id: string, text: string, tokens: number): Promise<string> {
    if (tokens === 0 || text.length <= tokens * 4) return text;
    const cap = tokens * 4;
    let saved = '';
    try {
      const dir = join(tmpdir(), 'dsh-hooks', sha(id).slice(0, 24)); await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, `${randomUUID()}.txt`); await writeFile(file, text, { mode: 0o600, flag: 'wx' }); saved = ` Full output: ${file}`;
    } catch { this.log('Could not save oversized hook context'); }
    return `${text.slice(0, Math.ceil(cap / 2))}\n[Hook context truncated.${saved}]\n${text.slice(-Math.floor(cap / 2))}`;
  }
  async detach(id: string): Promise<void> {
    const state = this.sessions.get(id); if (!state) return;
    if (state.draining) return state.draining;
    state.closed = true; state.life.abort(new Error('session ended')); state.revision.abort(new Error('session ended'));
    state.pending?.controller.abort(new Error('session ended')); state.queued.length = 0; state.contexts.length = 0;
    state.draining = (async () => {
      await Promise.allSettled([...state.active, ...state.refresh ? [state.refresh] : [], ...state.pending ? [state.pending.promise] : []]);
      if (this.sessions.get(id) === state) this.sessions.delete(id);
    })();
    return state.draining;
  }
  async dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    if (this.interval) clearInterval(this.interval); this.interval = undefined;
    this.lifetime.abort(new Error('hooks plugin disposed'));
    this.disposal = Promise.allSettled([...this.sessions.keys()].map(id => this.detach(id))).then(() => {});
    return this.disposal;
  }
}
