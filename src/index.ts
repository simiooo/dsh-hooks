import { randomUUID } from 'node:crypto';
import { HooksEngine, type Shell, type PermissionRequest } from './engine.js';
import type { Options } from './config.js';
import type { EventName, Outcome } from './protocol.js';
import { HooksManagement } from './management.js';
import { installCompactionBridge } from './compaction.js';
export { HooksEngine } from './engine.js';
export type { Options, Snapshot } from './config.js';
export type { PermissionRequest } from './engine.js';

export const name = 'simiooo-hooks';
export const inject = ['shell', 'workingDirectory', 'approval'];
// Structural public contracts keep this external package independent of monorepo builds.
type Block = { type: string; text?: string };
type Message = { id: string; role: 'user'; content: Block[]; source: { kind: string; event: string } };
interface Session { id: string; header: { id: string; cwd?: string; origin?: string; parentSession?: string }; snapshotEvents(): readonly SessionEvent[]; append?(event: string, data: unknown, intent: { surfaceOp: 'append' }): unknown }
interface SessionEvent { type: string; data: any }
interface Agent {
  id: string; session: Session; options?: { model?: string };
  inject(message: Message): void; steer(message: Message): void;
  cancel(cause: { kind: 'hook'; reason: string }, options?: { keepInbox: boolean }): void;
}
interface Context {
  shell: Shell;
  approval: { request(request: { agent: Agent; toolName: string; reason: string; displayReason?: { en: string; zh: string }; signal: AbortSignal }): Promise<string> };
  workingDirectory: { defaultDirectory?: string; get?(session: Session): string; ensure(agent: Agent, signal: AbortSignal): Promise<string> };
  logger: { warn(message: string): void };
  on(event: string, callback: (...args: any[]) => any): () => void;
  inject(services: string[], callback: (ctx: any) => Promise<void>): unknown;
  effect(init: () => (() => void | Promise<void>), label?: string): unknown;
}
interface State {
  source: string; started: boolean; turn: number; continued: number; last: string | null; model: string; cwd?: string;
  continuationIds: Set<string>; interruptedTurn?: number; closing?: boolean;
}
const text = (blocks: readonly Block[] = []) => blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('');
function contextMessage(context: string[], event: string): Message {
  const content = context.map(line => Object.freeze({ type: 'text', text: line }));
  return Object.freeze({ id: randomUUID(), role: 'user', content: Object.freeze(content) as unknown as Block[], source: Object.freeze({ kind: 'dsh-hooks', event }) });
}

/** Mount with a standard Cordis bundle row. Hook commands always require human review. */
export function apply(ctx: Context, options: Options = {}): void {
  const states = new Map<Agent, State>();
  const bySession = new Map<Session, Agent>();
  const detached = new Set<Promise<unknown>>();
  const closing = new Map<string, Promise<void>>();
  const ended = new WeakSet<Agent>();
  const compactionBridges = new Set<ReturnType<typeof installCompactionBridge>>();
  const lifetime = new AbortController();
  const track = (promise: Promise<unknown>) => {
    detached.add(promise); void promise.catch(error => ctx.logger.warn(String(error))).finally(() => detached.delete(promise));
  };
  const authorize = async (request: PermissionRequest, signal: AbortSignal) => {
    const agent = [...states.keys()].find(a => a.id === request.sessionId);
    if (!agent) return false;
    // This grants one explicit operation: trust this complete config revision for this session.
    const commands = request.hooks.map(h => `${h.event}: ${h.command}\n${h.source}`).join('\n\n');
    return await ctx.approval.request({ agent, toolName: 'dsh-hooks', reason: JSON.stringify(request), signal,
      displayReason: {
        en: `Allow these hooks for this session and this exact version? File changes require a new review.\n\n${commands}`,
        zh: `允许本会话运行以下版本的 Hooks？文件变化后需重新授权。\n\n${commands}`,
      },
    }) === 'allowed-once';
  };
  const engine = new HooksEngine(ctx.shell, authorize, options, msg => ctx.logger.warn(msg));
  const manager = new HooksManagement(engine.options, () => [
    ctx.workingDirectory.defaultDirectory ?? process.cwd(),
    ...[...states].filter(([, state]) => !state.closing).map(([agent, state]) => ctx.workingDirectory.get?.(agent.session) ?? state.cwd ?? agent.session.header.cwd ?? process.cwd()),
  ], async () => {
    for (const agent of states.keys()) engine.revoke(agent.id);
    await Promise.allSettled([...states.keys()].map(agent => engine.refresh(agent.id)));
  });
  ctx.inject(['typertGateway'], async apiCtx => {
    const { installPermissionApi } = await import('./permissions.js');
    await installPermissionApi(apiCtx, {
      revoke: id => engine.revoke(id), remember: (request, signal) => engine.remember(request, signal),
      status: id => engine.permissionStatus(id), forget: id => engine.forget(id),
    });
    const { installManagementApi } = await import('./management-api.js');
    await installManagementApi(apiCtx, manager);
  });
  engine.start();
  const stateOf = (agent: Agent): State => {
    let state = states.get(agent);
    if (!state) {
      state = { source: 'resume', started: false, turn: 0, continued: 0, last: null, model: agent.options?.model ?? '', continuationIds: new Set() };
      states.set(agent, state); bySession.set(agent.session, agent);
      for (const event of agent.session.snapshotEvents()) fold(state, event);
    }
    return state;
  };
  function fold(state: State, event: SessionEvent) {
    if (event.type === 'turn/start') { state.turn = event.data.turn; state.continued = 0; state.last = null; state.continuationIds.clear(); delete state.interruptedTurn; }
    if (event.type === 'assistant/message') state.last = text(event.data.message?.content ?? event.data.content ?? []);
    if (event.type === 'request/header') state.model = event.data.header?.config?.model ?? state.model;
    if (event.type === 'working-directory/change') state.cwd = event.data.cwd;
    if (event.type === 'agent/inbox/spliced') for (const message of event.data.inserted ?? []) rememberContinuation(state, message);
    if (event.type === 'user/message') rememberContinuation(state, event.data);
  }
  function rememberContinuation(state: State, message: Message) {
    if (message.source?.kind === 'dsh-hooks' && message.source.event === 'Stop' && !state.continuationIds.has(message.id)) {
      state.continuationIds.add(message.id); state.continued++;
    }
  }
  const payload = (agent: Agent, event: EventName, cwd: string, extra: Record<string, unknown> = {}) => {
    const state = stateOf(agent);
    return { session_id: agent.session.header.parentSession ?? agent.id, transcript_path: null, cwd,
      hook_event_name: event, model: state.model, permission_mode: 'default',
      ...(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt'].includes(event) ? { turn_id: String(state.turn) } : {}), ...extra };
  };
  async function run(agent: Agent, event: EventName, signal: AbortSignal, extra: Record<string, unknown> = {}, subjects: string[] = [], approvedOnly = false): Promise<Outcome> {
    const closed = (): Outcome => ({ block: true, halt: false, context: [], deferred: true, reason: 'Hooks session is closing.' });
    if (event !== 'SessionEnd' && (ended.has(agent) || lifetime.signal.aborted)) return closed();
    const state = stateOf(agent);
    if (state.closing && event !== 'SessionEnd') return closed();
    const cwd = event === 'SessionEnd' && state.cwd ? state.cwd : await ctx.workingDirectory.ensure(agent, signal);
    if (state.closing && event !== 'SessionEnd') return closed();
    state.cwd = cwd;
    engine.attach(agent.id, cwd);
    return engine.run(agent.id, event, payload(agent, event, cwd, extra), subjects, signal, approvedOnly);
  }
  const halt = (agent: Agent, outcome: Outcome) => {
    if (outcome.halt) agent.cancel({ kind: 'hook', reason: outcome.reason ?? 'Stopped by hook' }, { keepInbox: true });
  };
  ctx.inject(['compaction', 'sessions'], async scope => {
    const ownerAgent = (owner: { session: object }): Agent => {
      const agent = bySession.get(owner.session as Session) ?? owner as Agent;
      if (!agent.id || typeof agent.cancel !== 'function') throw new Error('Compaction hooks require a live Harness agent');
      stateOf(agent); return agent;
    };
    const compactEvent = async (owner: { session: object }, event: 'PreCompact' | 'PostCompact', trigger: 'manual' | 'auto', signal: AbortSignal) => {
      const agent = ownerAgent(owner), state = stateOf(agent);
      const out = await run(agent, event, signal, { trigger, turn_id: trigger === 'manual' ? '' : String(state.turn) }, [trigger], trigger === 'manual');
      if (out.halt || out.block || out.deferred) {
        const reason = trigger === 'manual' && out.deferred
          ? `${out.reason ?? 'Hook permission unavailable.'} Review hooks during a normal input turn before retrying /compact.`
          : out.reason ?? `${event} stopped compaction`;
        ctx.logger.warn(reason);
        agent.cancel({ kind: 'hook', reason }, { keepInbox: true }); throw new Error(reason);
      }
    };
    const bridge = installCompactionBridge(scope.compaction, {
      before: (owner, trigger, signal) => compactEvent(owner, 'PreCompact', trigger, signal),
      after: async (owner, trigger, signal) => {
        await compactEvent(owner, 'PostCompact', trigger, signal);
        const agent = ownerAgent(owner), state = stateOf(agent);
        if (agent.session.header.origin === 'subagent') return;
        state.source = 'compact'; state.started = false;
        // Include restoration before overflow retries too, which have no new agent/pre-step.
        const out = await run(agent, 'SessionStart', signal, { source: 'compact' }, ['compact'], trigger === 'manual');
        if (!out.deferred) state.started = true;
        if (out.halt || out.block || out.deferred) {
          const reason = out.reason ?? 'SessionStart stopped continuation after compaction';
          agent.cancel({ kind: 'hook', reason }, { keepInbox: true }); throw new Error(reason);
        }
        if (out.context.length) {
          if (!agent.session.append) throw new Error('Harness session append is unavailable');
          agent.session.append('user/message', contextMessage(out.context, 'SessionStart'), { surfaceOp: 'append' });
          if (trigger === 'manual') await scope.sessions.flush(agent.session);
        }
      }, warn: message => ctx.logger.warn(message),
    });
    compactionBridges.add(bridge);
    scope.effect(() => async () => { await bridge.dispose(); compactionBridges.delete(bridge); }, 'dsh-hooks: compaction adapter');
  });
  ctx.on('agent/created', async ({ agent, source }: { agent: Agent; source: string }) => {
    await closing.get(agent.id); const state = stateOf(agent); state.source = source; state.started = false;
  });
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    const agent = bySession.get(session); if (!agent) return;
    const state = stateOf(agent); fold(state, event);
    if (event.type === 'compaction/end' && event.data.error === undefined && !state.closing) {
      // Remember the committed lifecycle even when PostCompact stops or cancellation prevents its callback.
      state.source = 'compact'; state.started = false;
    }
    if (event.type === 'turn/end' && !state.closing && state.interruptedTurn !== event.data.turn && event.data.reason?.kind === 'aborted' && event.data.reason?.reason?.kind === 'user' && agent.session.header.origin !== 'subagent') {
      state.interruptedTurn = event.data.turn;
      track(run(agent, 'Interrupt', lifetime.signal, {}, [], true));
    }
  });
  ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }: { agent: Agent; messages: Message[]; turn: number; signal: AbortSignal }, next: () => Promise<any>) => {
    if (ended.has(agent) || lifetime.signal.aborted) return { kind: 'reject' };
    const state = stateOf(agent); state.turn = turn;
    if (state.closing) return { kind: 'reject' };
    const injected: string[] = [];
    if (!state.started) {
      // Approval requires an open turn and a visible Session. Still gates the very first model request.
      let outcome: Outcome;
      if (agent.session.header.origin === 'subagent') {
        const cwd = await ctx.workingDirectory.ensure(agent, signal);
        if (state.closing || ended.has(agent) || lifetime.signal.aborted || signal.aborted) return { kind: 'reject' };
        state.cwd = cwd; engine.attach(agent.id, cwd);
        outcome = { block: false, halt: false, context: [] };
      } else outcome = await run(agent, 'SessionStart', signal, { source: state.source }, [state.source]);
      if (!outcome.deferred) { state.started = true; engine.retainContexts(agent.id, outcome); }
      if (outcome.block || outcome.halt) { ctx.logger.warn(outcome.reason ?? 'SessionStart hook stopped this input'); return { kind: 'reject' }; }
    }
    const prompts = messages.filter(m => m.source.kind === 'user' || (m.source.kind === 'dsh-hooks' && m.source.event === 'Stop'));
    if (prompts.length) {
      const outcome = await run(agent, 'UserPromptSubmit', signal, { prompt: prompts.map(m => text(m.content)).join('\n') });
      if (outcome.block || outcome.halt) { ctx.logger.warn(outcome.reason ?? 'UserPromptSubmit hook rejected this input'); return { kind: 'reject' }; }
      injected.push(...outcome.context);
    }
    const downstream = await next();
    if (downstream.kind !== 'enter' || signal.aborted || state.closing || lifetime.signal.aborted) return downstream.kind === 'enter' ? { kind: 'reject' } : downstream;
    injected.unshift(...engine.takeContexts(agent.id));
    return downstream.kind === 'enter' && injected.length ? { ...downstream, messages: [...downstream.messages, contextMessage(injected, 'context')] } : downstream;
  });
  const toolData = (exec: any) => {
    const canonical = ['bash', 'exec_command'].includes(exec.name) ? 'Bash' : exec.name;
    const input = structuredClone(exec.arguments);
    if (canonical === 'Bash' && input && typeof input === 'object' && typeof input.command !== 'string' && typeof input.cmd === 'string') input.command = input.cmd;
    const subjects = canonical === 'apply_patch' ? [canonical, 'Edit', 'Write'] : [canonical, exec.name];
    return { extra: { tool_name: canonical, tool_input: input, tool_use_id: exec.callId }, subjects };
  };
  ctx.on('tools/pre-execute', async (exec: any, next: () => Promise<any>) => {
    if (!exec.agent) return next();
    const { extra, subjects } = toolData(exec);
    const out = await run(exec.agent, 'PreToolUse', exec.signal, extra, subjects);
    if (out.block || out.halt) return { kind: 'deny', reason: out.reason ?? 'Blocked by PreToolUse hook' };
    if (out.updatedInput) return { kind: 'deny', reason: `This Harness API cannot apply updatedInput. The original call was blocked; retry using: ${JSON.stringify(out.updatedInput).slice(0, 10_000)}` };
    if (out.context.length) exec.agent.inject(contextMessage(out.context, 'PreToolUse'));
    return next(); // An allow never bypasses downstream safety/approval policies.
  });
  ctx.on('tools/post-execute', async (exec: any, result: any, next: () => Promise<any>) => {
    if (!exec.agent) return next();
    const { extra, subjects } = toolData(exec);
    const out = await run(exec.agent, 'PostToolUse', exec.signal, { ...extra, tool_response: result.isError ? { error: result.error, content: result.content } : result.value !== undefined ? result.value : result.content }, subjects);
    const contexts = out.context.length ? [contextMessage(out.context, 'PostToolUse')] : [];
    if (out.block) return { kind: 'block', feedback: [{ type: 'text', text: out.reason ?? 'Blocked by PostToolUse hook' }], ...(contexts.length ? { additionalContexts: contexts } : {}) };
    const downstream = await next();
    let accepted = downstream;
    if (out.replace && downstream.kind !== 'block') {
      const { value: _value, ...metadata } = downstream;
      accepted = { ...metadata, content: [{ type: 'text', text: out.reason ?? 'Original tool output replaced by PostToolUse hook.' }] };
    }
    return contexts.length ? { ...accepted, additionalContexts: [...contexts, ...(accepted.additionalContexts ?? [])] } : accepted;
  });
  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }: { agent: Agent; turn: number; signal: AbortSignal }) => {
    if (agent.session.header.origin === 'subagent') return;
    const state = stateOf(agent); state.turn = turn;
    const out = await run(agent, 'Stop', signal, { stop_hook_active: state.continued > 0, last_assistant_message: state.last });
    if (out.deferred) return;
    if (out.halt) { halt(agent, out); return; }
    if (out.block) {
      if (state.continued >= (engine.options.maxStopContinuations ?? 10)) { ctx.logger.warn('Stop hook continuation limit reached'); return; }
      const message = contextMessage([out.reason ?? 'Continue: blocked by Stop hook', ...out.context], 'Stop');
      rememberContinuation(state, message); agent.steer(message);
    }
  });
  const close = (agent: Agent): Promise<void> => {
    const current = closing.get(agent.id); if (current) return current;
    ended.add(agent);
    const state = states.get(agent); if (state) state.closing = true;
    const work = Promise.resolve().then(async () => {
      engine.stopWork(agent.id);
      try { if (states.get(agent)?.started && agent.session.header.origin !== 'subagent') await run(agent, 'SessionEnd', lifetime.signal, { reason: 'other' }, ['other'], true); }
      finally { await engine.detach(agent.id); states.delete(agent); bySession.delete(agent.session); }
    });
    closing.set(agent.id, work);
    const clear = () => { closing.delete(agent.id); };
    void work.then(clear, clear);
    return work;
  };
  ctx.on('agent/disposed', ({ agent }: { agent: Agent }) => { if (states.has(agent)) track(close(agent)); });
  ctx.effect(() => async () => {
    await manager.dispose();
    await Promise.allSettled([...compactionBridges].map(bridge => bridge.dispose()));
    await Promise.allSettled([...states.keys()].map(close));
    lifetime.abort(); await engine.dispose(); await Promise.allSettled([...detached]); states.clear(); bySession.clear();
  }, 'dsh-hooks: cancel, drain, and release hooks');
}
