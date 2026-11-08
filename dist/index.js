import { randomUUID } from 'node:crypto';
import { HooksEngine } from './engine.js';
export { HooksEngine } from './engine.js';
export const name = 'simiooo-hooks';
export const inject = ['shell', 'workingDirectory', 'approval'];
const text = (blocks = []) => blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('');
function contextMessage(context, event) {
    const content = context.map(line => Object.freeze({ type: 'text', text: line }));
    return Object.freeze({ id: randomUUID(), role: 'user', content: Object.freeze(content), source: Object.freeze({ kind: 'dsh-hooks', event }) });
}
/** Mount with a standard Cordis bundle row. Hook commands always require human review. */
export function apply(ctx, options = {}) {
    const states = new Map();
    const bySession = new Map();
    const detached = new Set();
    const closing = new Map();
    const lifetime = new AbortController();
    const track = (promise) => {
        detached.add(promise);
        void promise.catch(error => ctx.logger.warn(String(error))).finally(() => detached.delete(promise));
    };
    const authorize = async (request, signal) => {
        const agent = [...states.keys()].find(a => a.id === request.sessionId);
        if (!agent)
            return false;
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
    ctx.inject(['typertGateway'], async (apiCtx) => {
        const { installPermissionApi } = await import('./permissions.js');
        await installPermissionApi(apiCtx, id => engine.revoke(id));
    });
    engine.start();
    const stateOf = (agent) => {
        let state = states.get(agent);
        if (!state) {
            state = { source: 'resume', started: false, turn: 0, continued: 0, last: null, model: agent.options?.model ?? '' };
            states.set(agent, state);
            bySession.set(agent.session, agent);
            for (const event of agent.session.snapshotEvents())
                fold(state, event);
        }
        return state;
    };
    function fold(state, event) {
        if (event.type === 'turn/start') {
            state.turn = event.data.turn;
            state.continued = 0;
            state.last = null;
        }
        if (event.type === 'assistant/message')
            state.last = text(event.data.message?.content ?? event.data.content ?? []);
        if (event.type === 'request/header')
            state.model = event.data.header?.config?.model ?? state.model;
    }
    const payload = (agent, event, cwd, extra = {}) => {
        const state = stateOf(agent);
        return { session_id: agent.session.header.parentSession ?? agent.id, transcript_path: null, cwd,
            hook_event_name: event, model: state.model, permission_mode: 'default',
            ...(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt'].includes(event) ? { turn_id: String(state.turn) } : {}), ...extra };
    };
    async function run(agent, event, signal, extra = {}, subjects = [], approvedOnly = false) {
        const state = stateOf(agent);
        const cwd = event === 'SessionEnd' && state.cwd ? state.cwd : await ctx.workingDirectory.ensure(agent, signal);
        state.cwd = cwd;
        engine.attach(agent.id, cwd);
        return engine.run(agent.id, event, payload(agent, event, cwd, extra), subjects, signal, approvedOnly);
    }
    const halt = (agent, outcome) => {
        if (outcome.halt)
            agent.cancel({ kind: 'hook', reason: outcome.reason ?? 'Stopped by hook' }, { keepInbox: true });
    };
    ctx.on('agent/created', async ({ agent, source }) => {
        await closing.get(agent.id);
        stateOf(agent).source = source;
    });
    ctx.on('session/event', (session, event) => {
        const agent = bySession.get(session);
        if (!agent)
            return;
        const state = stateOf(agent);
        fold(state, event);
        if (event.type === 'turn/end' && event.data.reason?.kind === 'aborted' && event.data.reason?.reason?.kind === 'user' && agent.session.header.origin !== 'subagent') {
            track(run(agent, 'Interrupt', lifetime.signal, {}, [], true));
        }
    });
    ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next) => {
        const state = stateOf(agent);
        state.turn = turn;
        const injected = [];
        if (!state.started) {
            // Approval requires an open turn and a visible Session. Still gates the very first model request.
            const outcome = agent.session.header.origin === 'subagent'
                ? (engine.attach(agent.id, await ctx.workingDirectory.ensure(agent, signal)), { block: false, halt: false, context: [] })
                : await run(agent, 'SessionStart', signal, { source: state.source }, [state.source]);
            if (outcome.block || outcome.halt) {
                ctx.logger.warn(outcome.reason ?? 'SessionStart hook stopped this input');
                return { kind: 'reject' };
            }
            state.started = true;
            injected.push(...outcome.context);
        }
        injected.push(...engine.takeContexts(agent.id));
        const prompts = messages.filter(m => m.source.kind === 'user' || (m.source.kind === 'dsh-hooks' && m.source.event === 'Stop'));
        if (prompts.length) {
            const outcome = await run(agent, 'UserPromptSubmit', signal, { prompt: prompts.map(m => text(m.content)).join('\n') });
            if (outcome.block || outcome.halt) {
                ctx.logger.warn(outcome.reason ?? 'UserPromptSubmit hook rejected this input');
                return { kind: 'reject' };
            }
            injected.push(...outcome.context);
        }
        const downstream = await next();
        return downstream.kind === 'enter' && injected.length ? { ...downstream, messages: [...downstream.messages, contextMessage(injected, 'context')] } : downstream;
    });
    const toolData = (exec) => {
        const canonical = ['bash', 'exec_command'].includes(exec.name) ? 'Bash' : exec.name;
        const input = structuredClone(exec.arguments);
        if (canonical === 'Bash' && input && typeof input === 'object' && typeof input.command !== 'string' && typeof input.cmd === 'string')
            input.command = input.cmd;
        const subjects = canonical === 'apply_patch' ? [canonical, 'Edit', 'Write'] : [canonical, exec.name];
        return { extra: { tool_name: canonical, tool_input: input, tool_use_id: exec.callId }, subjects };
    };
    ctx.on('tools/pre-execute', async (exec, next) => {
        if (!exec.agent)
            return next();
        const { extra, subjects } = toolData(exec);
        const out = await run(exec.agent, 'PreToolUse', exec.signal, extra, subjects);
        if (out.block || out.halt || out.updatedInput)
            return { kind: 'deny', reason: out.updatedInput
                    ? `This Harness API cannot apply updatedInput. The original call was blocked; retry using: ${JSON.stringify(out.updatedInput).slice(0, 10_000)}` : out.reason ?? 'Blocked by PreToolUse hook' };
        if (out.context.length)
            exec.agent.inject(contextMessage(out.context, 'PreToolUse'));
        return next(); // An allow never bypasses downstream safety/approval policies.
    });
    ctx.on('tools/post-execute', async (exec, result, next) => {
        if (!exec.agent)
            return next();
        const { extra, subjects } = toolData(exec);
        const out = await run(exec.agent, 'PostToolUse', exec.signal, { ...extra, tool_response: result.isError ? { error: result.error, content: result.content } : result.value ?? result.content }, subjects);
        halt(exec.agent, out);
        const contexts = out.context.length ? [contextMessage(out.context, 'PostToolUse')] : [];
        if (out.block)
            return { kind: 'block', feedback: [{ type: 'text', text: out.reason ?? 'Blocked by PostToolUse hook' }], ...(contexts.length ? { additionalContexts: contexts } : {}) };
        const downstream = await next();
        return contexts.length ? { ...downstream, additionalContexts: [...contexts, ...(downstream.additionalContexts ?? [])] } : downstream;
    });
    ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
        if (agent.session.header.origin === 'subagent')
            return;
        const state = stateOf(agent);
        state.turn = turn;
        const out = await run(agent, 'Stop', signal, { stop_hook_active: state.continued > 0, last_assistant_message: state.last });
        if (out.halt) {
            halt(agent, out);
            return;
        }
        if (out.block) {
            if (state.continued >= (options.maxStopContinuations ?? 10)) {
                ctx.logger.warn('Stop hook continuation limit reached');
                return;
            }
            state.continued++;
            agent.steer(contextMessage([out.reason ?? 'Continue: blocked by Stop hook', ...out.context], 'Stop'));
        }
    });
    const close = (agent) => {
        const current = closing.get(agent.id);
        if (current)
            return current;
        const work = (async () => {
            engine.stopWork(agent.id);
            try {
                if (states.get(agent)?.started && agent.session.header.origin !== 'subagent')
                    await run(agent, 'SessionEnd', lifetime.signal, { reason: 'other' }, ['other'], true);
            }
            finally {
                await engine.detach(agent.id);
                states.delete(agent);
                bySession.delete(agent.session);
            }
        })();
        closing.set(agent.id, work);
        const clear = () => { closing.delete(agent.id); };
        void work.then(clear, clear);
        return work;
    };
    ctx.on('agent/disposed', ({ agent }) => { if (states.has(agent))
        track(close(agent)); });
    ctx.effect(() => async () => {
        await Promise.allSettled([...states.keys()].map(close));
        lifetime.abort();
        await engine.dispose();
        await Promise.allSettled([...detached]);
        states.clear();
        bySession.clear();
    }, 'dsh-hooks: cancel, drain, and release hooks');
}
//# sourceMappingURL=index.js.map