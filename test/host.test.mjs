import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../dist/index.js';

const signal = () => new AbortController().signal;
const message = (value = 'hello', source = { kind: 'user', event: 'input' }) => ({ id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: value }], source });
const text = messages => messages.flatMap(m => m.content).filter(b => b.type === 'text').map(b => b.text);
const success = stdout => ({ exitCode: 0, stdout: { text: stdout ?? '' }, stderr: { text: '' } });
const json = value => success(JSON.stringify(value));
async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) { assert(Date.now() < deadline, 'operation did not settle'); await new Promise(r => setTimeout(r, 5)); }
}
async function fixture(t, handlers = {}, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh host edges '));
  const file = join(dir, 'hooks.json');
  const hooks = Object.fromEntries(Object.keys(handlers).map(event => [event, [{ hooks: [{ type: 'command', command: event }] }]]));
  await writeFile(file, JSON.stringify({ hooks }));
  const listeners = new Map(), cleanups = [], calls = [], reviews = [], logs = [], injected = [], steered = [], cancelled = [];
  let ensureCount = 0;
  const ctx = {
    on(event, callback) { listeners.set(event, callback); return () => listeners.delete(event); },
    inject(dependencies, init) { if (dependencies.length === 1 && dependencies[0] === 'approval') void init(ctx); }, effect(init) { cleanups.push(init()); }, logger: { warn: x => logs.push(x) },
    workingDirectory: { async ensure(...args) { ensureCount++; return options.ensure ? options.ensure(...args) : dir; } },
    approval: { async request(request) { reviews.push(request); return options.authorize ? options.authorize(request) : 'allowed-once'; } },
    shell: { resolve: x => x, async execute(request) {
      const input = JSON.parse(request.stdin); calls.push({ ...request, input });
      return { result: async () => handlers[input.hook_event_name]?.(input, request) ?? success() };
    } },
  };
  apply(ctx, { discover: false, configPaths: [file], shellFlavor: 'posix', maxStopContinuations: 2, ...options.engine });
  const session = { id: 's1', header: { id: 's1', cwd: dir, ...options.header }, snapshotEvents: () => options.history ?? [] };
  const agent = { id: 's1', session, options: { model: 'model' }, inject: x => injected.push(x), steer(x) {
    steered.push(x); listeners.get('session/event')(session, { type: 'agent/inbox/spliced', data: { inserted: [x] } });
  }, cancel: (...x) => cancelled.push(x) };
  const emit = (event, ...args) => listeners.get(event)(...args);
  const feed = (type, data) => listeners.get('session/event')(session, { type, data });
  const pre = (messages = [message()], next = async () => ({ kind: 'enter', messages }), sig = signal()) =>
    listeners.get('agent/pre-step')({ agent, messages, turn: 1, signal: sig }, next);
  const exec = (name = 'exec_command') => ({ agent, name, callId: 'call', arguments: { cmd: 'echo hello' }, signal: signal() });
  const preTool = (execution = exec(), next = async () => ({ kind: 'allow' })) => listeners.get('tools/pre-execute')(execution, next);
  const postTool = (result = { value: null }, next = async () => ({ kind: 'accept' }), execution = exec()) => listeners.get('tools/post-execute')(execution, result, next);
  const stop = () => emit('agent/turn-stopping', { agent, turn: 1, signal: signal() });
  await emit('agent/created', { agent, source: options.source ?? 'startup' });
  if (!options.history) feed('turn/start', { turn: 1 });
  const cleanup = async () => { for (const fn of cleanups.splice(0)) await fn(); };
  t.after(async () => { await cleanup(); await rm(dir, { recursive: true, force: true }); });
  return { agent, session, dir, file, calls, reviews, logs, injected, steered, cancelled, emit, feed, pre, exec, preTool, postTool, stop, cleanup, ensureCount: () => ensureCount };
}

test('SessionStart context survives prompt rejection and downstream rejection until first admitted request', async t => {
  let blocked = true;
  const f = await fixture(t, {
    SessionStart: () => success('startup-context'),
    UserPromptSubmit: () => blocked ? json({ decision: 'block', reason: 'retry' }) : success('prompt-context'),
  });
  assert.equal((await f.pre()).kind, 'reject'); blocked = false;
  assert.equal((await f.pre(undefined, async () => ({ kind: 'reject' }))).kind, 'reject');
  const result = await f.pre(); assert.deepEqual(text(result.messages), ['hello', 'startup-context', 'prompt-context']);
  assert.equal(f.calls.filter(c => c.input.hook_event_name === 'SessionStart').length, 1);
  assert.deepEqual(text((await f.pre()).messages), ['hello', 'prompt-context']);
});

test('SessionStart continue:false rejects once; unavailable permission skips hooks without losing the prompt', async t => {
  const f = await fixture(t, { SessionStart: () => json({ continue: false, stopReason: 'initial gate' }) });
  assert.equal((await f.pre()).kind, 'reject'); assert.equal((await f.pre()).kind, 'enter'); assert.equal(f.calls.length, 1);
  let allowed = false;
  const denied = await fixture(t, { SessionStart: () => success('now allowed') }, { authorize: () => allowed ? 'allowed-once' : 'rejected' });
  assert.equal((await denied.pre()).kind, 'enter'); assert.equal(denied.calls.length, 0); allowed = true;
  assert(text((await denied.pre()).messages).includes('now allowed')); assert.equal(denied.reviews.length, 2);
});
test('rejected, missing and throwing approval never swallow chat; unapproved tool hooks still deny tools', async t => {
  for (const outcome of ['rejected', 'unavailable', 'throw']) {
    const f = await fixture(t, { SessionStart: () => success('private startup'), UserPromptSubmit: () => success('private prompt'), PreToolUse: () => success() }, {
      authorize: () => { if (outcome === 'throw') throw new Error('answerer unavailable'); return outcome; },
    });
    const result = await f.pre(); assert.equal(result.kind, 'enter'); assert.deepEqual(text(result.messages), ['hello']);
    assert.equal(f.calls.length, 0); assert.equal((await f.preTool()).kind, 'deny'); assert.equal(f.calls.length, 0);
  }
});

test('SessionStart source and compact lifecycle run even without a fresh user prompt', async t => {
  const sources = [];
  const f = await fixture(t, { SessionStart: input => { sources.push(input.source); return success(input.source); } });
  await f.pre(); await f.emit('agent/created', { agent: f.agent, source: 'compact' });
  const result = await f.pre([message('context', { kind: 'dsh-hooks', event: 'context' })]);
  assert.deepEqual(sources, ['startup', 'compact']); assert(text(result.messages).includes('compact'));
});

test('UserPromptSubmit ignores context-only steps, preserves multimodal messages and handles Stop input', async t => {
  const prompts = [];
  const f = await fixture(t, { UserPromptSubmit: input => { prompts.push(input.prompt); return success(); } });
  await f.pre([message('context', { kind: 'dsh-hooks', event: 'context' })]); assert.equal(prompts.length, 0);
  const mixed = message('text'); mixed.content.push({ type: 'image', url: 'fixture' });
  const result = await f.pre([mixed]); assert.equal(result.messages[0], mixed); assert.equal(result.messages[0].content[1].type, 'image');
  await f.pre([message('continue', { kind: 'dsh-hooks', event: 'Stop' })]); assert.deepEqual(prompts, ['text', 'continue']);
});

test('cancellation during downstream pre-step preserves retained context and never enters model', async t => {
  const f = await fixture(t, { SessionStart: () => success('retained') });
  const controller = new AbortController();
  const result = await f.pre(undefined, async () => { controller.abort(); return { kind: 'enter', messages: [] }; }, controller.signal);
  assert.equal(result.kind, 'reject'); assert(text((await f.pre()).messages).includes('retained'));
});

test('PreToolUse canonical input and parent session are complete; allow cannot bypass downstream denial', async t => {
  const f = await fixture(t, { PreToolUse: () => json({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', additionalContext: 'hint' } }) }, { header: { parentSession: 'parent' } });
  const decision = await f.preTool(undefined, async () => ({ kind: 'deny', reason: 'downstream policy' }));
  assert.equal(decision.reason, 'downstream policy'); assert.equal(f.injected.length, 1);
  const input = f.calls[0].input;
  assert.equal(input.session_id, 'parent'); assert.equal(input.tool_name, 'Bash'); assert.equal(input.tool_use_id, 'call');
  assert.deepEqual(input.tool_input, { cmd: 'echo hello', command: 'echo hello' });
  const execution = f.exec(); delete execution.agent; await f.preTool(execution); assert.equal(f.calls.length, 1);
});

test('PreToolUse rewrite never executes original args; explicit deny wins another rewrite handler', async t => {
  const f = await fixture(t, { PreToolUse: () => json({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { cmd: 'safe' } } }) });
  let downstream = 0;
  const result = await f.preTool(undefined, async () => { downstream++; return { kind: 'allow' }; });
  assert.equal(result.kind, 'deny'); assert.match(result.reason, /updatedInput/); assert.equal(downstream, 0);
  // A legacy deny alongside rewrite must still use the policy feedback.
  const other = await fixture(t, { PreToolUse: () => json({ decision: 'block', reason: 'policy reason', hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: {} } }) });
  assert.equal((await other.preTool()).reason, 'policy reason');
});

test('PostToolUse preserves JSON falsy values and observes errors after execution', async t => {
  const observed = [];
  const f = await fixture(t, { PostToolUse: input => { observed.push(input.tool_response); return success(); } });
  for (const value of [null, false, 0, '', { nested: null }]) await f.postTool({ value, content: [{ type: 'text', text: 'fallback' }] });
  await f.postTool({ isError: true, error: 'failed', content: [] });
  assert.deepEqual(observed, [null, false, 0, '', { nested: null }, { error: 'failed', content: [] }]);
});

test('PostToolUse continue:false replaces output, preserves metadata and never cancels the turn', async t => {
  const f = await fixture(t, { PostToolUse: () => json({ continue: false, stopReason: 'use feedback', hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'extra' } }) });
  const result = await f.postTool({ value: null }, async () => ({ kind: 'accept', value: null, metadata: 'preserved', additionalContexts: [message('downstream')] }));
  assert.equal(result.kind, 'accept'); assert.equal('value' in result, false); assert.equal(result.content[0].text, 'use feedback');
  assert.equal(result.metadata, 'preserved'); assert.deepEqual(text(result.additionalContexts), ['extra', 'downstream']); assert.equal(f.cancelled.length, 0);
  const blocked = await f.postTool({}, async () => ({ kind: 'block', feedback: [{ type: 'text', text: 'policy' }] }));
  assert.equal(blocked.feedback[0].text, 'policy'); assert.equal('content' in blocked, false);
});

test('PostToolUse decision:block emits feedback; malformed unsupported output leaves native result intact', async t => {
  let unsupported = false;
  const f = await fixture(t, { PostToolUse: () => json(unsupported ? { suppressOutput: true, decision: 'block' } : { decision: 'block', reason: 'review result' }) });
  let next = 0; const downstream = async () => { next++; return { kind: 'accept', value: 0 }; };
  assert.equal((await f.postTool({}, downstream)).feedback[0].text, 'review result'); assert.equal(next, 0);
  unsupported = true; assert.deepEqual(await f.postTool({}, downstream), { kind: 'accept', value: 0 }); assert.equal(next, 1); assert(f.logs.some(l => l.includes('failed')));
});

test('Stop continuation tracks live and replayed messages once, caps loops, resets each turn', async t => {
  const observed = [];
  const f = await fixture(t, { Stop: input => { observed.push(input); return json({ decision: 'block', reason: 'continue' }); } });
  f.feed('assistant/message', { message: { content: [{ type: 'text', text: 'last' }] } });
  await f.stop(); await f.stop(); await f.stop(); assert.equal(f.steered.length, 2);
  assert.deepEqual(observed.map(x => x.stop_hook_active), [false, true, true]); assert.equal(observed[0].last_assistant_message, 'last');
  f.feed('turn/start', { turn: 2 }); await f.stop(); assert.equal(f.steered.length, 3); assert.equal(observed.at(-1).stop_hook_active, false); assert.equal(observed.at(-1).last_assistant_message, null);
  const continuation = message('resume', { kind: 'dsh-hooks', event: 'Stop' });
  const replay = await fixture(t, { Stop: input => { assert.equal(input.stop_hook_active, true); return success(); } }, { history: [
    { type: 'turn/start', data: { turn: 1 } }, { type: 'agent/inbox/spliced', data: { inserted: [continuation] } }, { type: 'user/message', data: continuation },
  ] }); await replay.stop();
});

test('Stop halt wins continuation and unavailable permission/config never manufactures continuation', async t => {
  const f = await fixture(t, { Stop: () => json({ continue: false, decision: 'block', stopReason: 'done' }) });
  await f.stop(); assert.equal(f.cancelled.length, 1); assert.equal(f.steered.length, 0);
  const denied = await fixture(t, { Stop: () => json({ decision: 'block' }) }, { authorize: () => 'rejected' });
  await denied.stop(); assert.equal(denied.steered.length, 0); assert.equal(denied.cancelled.length, 0);
  await writeFile(denied.file, '{'); await denied.stop(); assert.equal(denied.steered.length, 0);
});

test('Interrupt only observes user abort once per main turn; controls cannot restart or re-prompt', async t => {
  const f = await fixture(t, { PreToolUse: () => success(), Interrupt: () => json({ continue: false, decision: 'block' }) });
  await f.preTool();
  for (const kind of ['hook', 'parent', 'disposed', 'user', 'user']) f.feed('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind } } });
  await until(() => f.calls.some(c => c.input.hook_event_name === 'Interrupt'));
  assert.equal(f.calls.filter(c => c.input.hook_event_name === 'Interrupt').length, 1); assert.equal(f.reviews.length, 1);
  assert.equal(f.cancelled.length + f.steered.length, 0); assert.equal(f.calls.at(-1).timeoutMs, 1000);
  const unreviewed = await fixture(t, { Interrupt: () => success() });
  unreviewed.feed('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } });
  await new Promise(r => setTimeout(r, 30)); assert.equal(unreviewed.reviews.length + unreviewed.calls.length, 0);
});

test('subagents skip main-only SessionStart, Stop, Interrupt, SessionEnd while retaining tool gates', async t => {
  const f = await fixture(t, Object.fromEntries(['SessionStart', 'Stop', 'Interrupt', 'SessionEnd', 'PreToolUse'].map(event => [event, () => success()])), { header: { origin: 'subagent', parentSession: 'parent' } });
  await f.pre(); await f.stop(); f.feed('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } });
  await f.preTool(); await f.cleanup(); assert.deepEqual(f.calls.map(c => c.input.hook_event_name), ['PreToolUse']);
});

test('SessionEnd deduplicates disposal/unload and uses cached latest cwd without a fresh approval', async t => {
  const f = await fixture(t, { SessionStart: () => success(), SessionEnd: () => success() });
  await f.pre(); const ensures = f.ensureCount();
  f.feed('working-directory/change', { cwd: f.dir });
  f.emit('agent/disposed', { agent: f.agent }); f.emit('agent/disposed', { agent: f.agent }); await f.cleanup();
  assert.deepEqual(f.calls.map(c => c.input.hook_event_name), ['SessionStart', 'SessionEnd']);
  assert.equal(f.ensureCount(), ensures); assert.equal(f.reviews.length, 1); assert.equal(f.calls.at(-1).timeoutMs, 1000);
  assert.equal((await f.pre()).kind, 'reject');
});

test('SessionEnd never launches an unreviewed cleanup-only configuration', async t => {
  const f = await fixture(t, { SessionEnd: () => success() }); await f.pre(); await f.cleanup();
  assert.equal(f.calls.length, 0); assert.equal(f.reviews.length, 0);
});

test('disposal while working-directory initialization waits cannot resurrect hooks afterward', async t => {
  for (const origin of [undefined, 'subagent']) {
    let finish;
    const f = await fixture(t, { SessionStart: () => success() }, { header: { origin }, ensure: () => new Promise(r => finish = r) });
    const pending = f.pre(); await until(() => finish); f.emit('agent/disposed', { agent: f.agent }); await f.cleanup(); finish(f.dir);
    assert.equal((await pending).kind, 'reject'); assert.equal(f.calls.length + f.reviews.length, 0);
  }
});

test('same-ID agent creation waits for old cleanup and does not inherit its approval or context', async t => {
  let finish;
  const f = await fixture(t, { SessionStart: () => success('startup'), SessionEnd: () => finish ? success() : new Promise(r => finish = r) });
  await f.pre(); f.emit('agent/disposed', { agent: f.agent }); await until(() => finish);
  const agent = { ...f.agent, session: { ...f.session, header: { ...f.session.header } } }; let created = false;
  const pending = f.emit('agent/created', { agent, source: 'resume' }).then(() => { created = true; });
  await new Promise(r => setTimeout(r, 10)); assert.equal(created, false); finish(success()); await pending;
  const messages = [message()];
  const result = await f.emit('agent/pre-step', { agent, messages, turn: 1, signal: signal() }, async () => ({ kind: 'enter', messages }));
  assert.equal(result.kind, 'enter'); assert.equal(f.reviews.length, 2);
});
