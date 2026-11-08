import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HooksEngine } from '../dist/engine.js';
import { loadSnapshot } from '../dist/config.js';

const signal = () => new AbortController().signal;
const success = (stdout = '') => ({ exitCode: 0, stdout: { text: stdout }, stderr: { text: '' } });
const hook = (command, extra = {}) => ({ type: 'command', command, ...extra });
const config = (event, handlers) => ({ hooks: { [event]: [{ hooks: handlers }] } });
async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) { assert(Date.now() < deadline, 'operation did not settle'); await new Promise(r => setTimeout(r, 5)); }
}
async function fixture(t, data, execute = () => success(), authorize = async () => true, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh hooks '));
  const file = join(dir, 'hooks.json'); await writeFile(file, JSON.stringify(data));
  const calls = [], reviews = [], logs = [];
  const shell = { resolve: x => x, execute: async request => { calls.push(request); return { result: async () => execute(request) }; } };
  const engine = new HooksEngine(shell, async (request, sig) => { reviews.push(request); return authorize(request, sig); }, { discover: false, configPaths: [file], shellFlavor: 'posix', ...options }, msg => logs.push(msg));
  engine.attach('session', dir);
  t.after(async () => { await engine.dispose(); await rm(dir, { recursive: true, force: true }); });
  return { dir, file, engine, calls, reviews, logs, run: (event = 'PreToolUse', sig = signal()) => engine.run('session', event, { hook_event_name: event, cwd: dir, tool_input: { path: '中文' } }, ['Bash'], sig) };
}

test('stdin is one JSON object without an extra newline; cwd/env and seconds survive', async t => {
  const f = await fixture(t, config('PreToolUse', [hook('fixture', { timeout: 1.5 })])); await f.run();
  assert.equal(f.calls[0].timeoutMs, 1500); assert.equal(f.calls[0].workdir, f.dir);
  assert.equal(f.calls[0].stdin.endsWith('\n'), false); assert.equal(JSON.parse(f.calls[0].stdin).tool_input.path, '中文');
});

test('default is fail closed without human permission; permission is per session and revision', async t => {
  const denied = await fixture(t, config('PreToolUse', [hook('never')]), undefined, async () => false);
  assert((await denied.run()).block); assert.equal(denied.calls.length, 0);
  const f = await fixture(t, config('PreToolUse', [hook('approved')]));
  await Promise.all([f.run(), f.run()]); assert.equal(f.reviews.length, 1); assert.equal(f.calls.length, 2);
  f.engine.attach('second', f.dir); await f.engine.run('second', 'PreToolUse', {}, ['Bash'], signal());
  assert.equal(f.reviews.length, 2);
});

test('all matching commands launch concurrently and merge in configuration order', async t => {
  const seen = [];
  const resolvers = [];
  const f = await fixture(t, config('PreToolUse', [hook('a'), hook('b')]), request => new Promise(resolve => { seen.push(request.command); resolvers.push(resolve); }));
  const pending = f.run();
  while (seen.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(seen, ['a', 'b']);
  resolvers[1](success('{"decision":"block","reason":"second"}'));
  resolvers[0](success('{"decision":"block","reason":"first"}'));
  assert.equal((await pending).reason, 'first');
});

test('atomic save reloads handlers and asks again without plugin restart', async t => {
  const f = await fixture(t, config('PreToolUse', [hook('old')])); await f.run();
  await writeFile(join(f.dir, 'tmp'), JSON.stringify(config('PreToolUse', [hook('new')])));
  await rename(join(f.dir, 'tmp'), f.file); await f.run();
  assert.deepEqual(f.calls.map(c => c.command), ['old', 'new']); assert.equal(f.reviews.length, 2);
});

test('script-only edits, including same-size writes, invalidate permission', async t => {
  const f = await fixture(t, config('PreToolUse', [hook('node "./script.mjs"')]));
  await writeFile(join(f.dir, 'script.mjs'), 'one'); await f.run();
  await writeFile(join(f.dir, 'script.mjs'), 'two'); await f.run();
  assert.equal(f.reviews.length, 2); assert.notEqual(f.reviews[0].fingerprint, f.reviews[1].fingerprint);
});

test('edit during human review withdraws the old request and runs no stale command', async t => {
  let approvalStarted;
  const started = new Promise(r => approvalStarted = r);
  const f = await fixture(t, config('PreToolUse', [hook('old')]), undefined, (_r, sig) => new Promise(resolve => {
    approvalStarted(); sig.addEventListener('abort', () => resolve(false), { once: true });
  }));
  const pending = f.run(); await started;
  await writeFile(f.file, JSON.stringify(config('PreToolUse', [hook('new')]))); await f.engine.refresh('session');
  assert((await pending).block); assert.equal(f.calls.length, 0);
});

test('malformed reload cannot silently execute the previous approved configuration', async t => {
  const f = await fixture(t, config('PreToolUse', [hook('old')])); await f.run();
  await writeFile(f.file, '{'); const invalid = await f.run(); assert(invalid.block && invalid.deferred); assert.equal(f.calls.length, 1);
  await writeFile(f.file, JSON.stringify(config('PreToolUse', [hook('new')]))); await f.run();
  assert.equal(f.calls[1].command, 'new'); assert.equal(f.reviews.length, 2);
});

test('manual revocation cancels an in-flight gate and forces a fresh review', async t => {
  let first = true;
  const f = await fixture(t, config('PreToolUse', [hook('policy')]), request => {
    if (!first) return success(); first = false;
    return new Promise(resolve => request.signal.addEventListener('abort', () => resolve({ ...success(), aborted: true }), { once: true }));
  });
  const pending = f.run();
  while (!f.calls.length) await new Promise(r => setTimeout(r, 5));
  f.engine.revoke('session'); assert.equal((await pending).block, true);
  await f.run(); assert.equal(f.reviews.length, 2);
});

test('the hot reload poll detects edits before the next invocation', async t => {
  const f = await fixture(t, config('PreToolUse', [hook('old')]), undefined, undefined, { pollIntervalMs: 10 });
  f.engine.start(); await f.run();
  await writeFile(f.file, JSON.stringify(config('PreToolUse', [hook('new')])));
  const until = Date.now() + 2000;
  while (f.logs.filter(line => line.startsWith('Hooks reloaded')).length < 2) {
    assert(Date.now() < until); await new Promise(r => setTimeout(r, 5));
  }
  assert.equal(f.reviews.length, 1); await f.run(); assert.equal(f.reviews.length, 2);
});

test('infrastructure faults, malformed output and timeouts are nonblocking and diagnostic', async t => {
  for (const result of [success('{'), { ...success('{"decision":"block"}'), timedOut: true }, { exitCode: 1, stdout: { text: '' }, stderr: { text: 'crashed' } }, { ...success('{"decision":"block"}'), stdout: { text: '{}', truncated: true } }]) {
    const f = await fixture(t, config('PreToolUse', [hook('x')]), () => result);
    assert.equal((await f.run()).block, false); assert(f.logs.some(l => l.includes('failed')));
  }
});

test('async output arrives at a later boundary and cannot veto the action', async t => {
  let finish;
  const f = await fixture(t, config('PostToolUse', [hook('background', { async: true })]), () => new Promise(r => finish = r));
  const out = await f.run('PostToolUse'); assert.equal(out.block, false);
  finish(success('{"decision":"block","hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"later"}}'));
  while (f.engine.takeContexts('session').length === 0) await new Promise(r => setTimeout(r, 5));
});

test('async pool is bounded to eight; disposal cancels and drains processes', async t => {
  const f = await fixture(t, config('PostToolUse', Array.from({ length: 12 }, (_, i) => hook(String(i), { async: true }))), request => new Promise(resolve => {
    if (request.signal.aborted) resolve({ ...success(), aborted: true });
    else request.signal.addEventListener('abort', () => resolve({ ...success(), aborted: true }), { once: true });
  }));
  await f.run('PostToolUse'); assert.equal(f.calls.length, 8);
  await f.engine.dispose(); assert.equal(f.calls.length, 8);
});

test('cleanup hooks reuse reviewed versions and have one-to-three-second budgets', async t => {
  const f = await fixture(t, { hooks: { PreToolUse: [{ hooks: [hook('gate')] }], SessionEnd: [{ hooks: [hook('cleanup', { timeout: 50, async: true })] }] } });
  await f.run(); await f.engine.run('session', 'SessionEnd', {}, ['other'], signal(), true);
  assert.equal(f.reviews.length, 1); assert.equal(f.calls[1].timeoutMs, 3000);
});

test('discovery merges user JSON, inline TOML, repo root, and active nested layers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hooks discovery ')); t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home'), repo = join(root, 'repo'), sub = join(repo, 'sub');
  await mkdir(join(repo, '.git'), { recursive: true }); await mkdir(join(repo, '.codex'));
  await mkdir(join(sub, '.codex'), { recursive: true }); await mkdir(home);
  await writeFile(join(home, 'hooks.json'), JSON.stringify(config('Stop', [hook('user')])));
  await writeFile(join(home, 'config.toml'), '[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "toml"\n');
  await writeFile(join(repo, '.codex', 'hooks.json'), JSON.stringify(config('Stop', [hook('repo')])));
  await writeFile(join(sub, '.codex', 'hooks.json'), JSON.stringify(config('Stop', [hook('sub')])));
  assert.deepEqual((await loadSnapshot(sub, { codexHome: home })).hooks.map(h => h.command), ['user', 'toml', 'repo', 'sub']);
});

test('plugin manifests resolve resources, environment, and enforce root confinement', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hooks plugin ')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'hooks'));
  await writeFile(join(root, 'hooks', 'hooks.json'), JSON.stringify(config('Stop', [hook('node "${PLUGIN_ROOT}/hooks/script.mjs"')])));
  await writeFile(join(root, 'hooks', 'script.mjs'), 'first');
  const one = await loadSnapshot(root, { discover: false, pluginRoots: [root] });
  assert.equal(one.hooks[0].env.PLUGIN_ROOT, await realpath(root));
  await writeFile(join(root, 'hooks', 'script.mjs'), 'other');
  assert.notEqual((await loadSnapshot(root, { discover: false, pluginRoots: [root] })).fingerprint, one.fingerprint);
  await writeFile(join(root, 'plugin.json'), JSON.stringify({ extensions: { 'com.openai': { hooks: './../outside.json' } } }));
  await assert.rejects(loadSnapshot(root, { discover: false, pluginRoots: [root] }), /escapes root/);
});

test('permission timeout bounds even a provider that ignores cancellation; late answers cannot grant', async t => {
  let finish;
  const f = await fixture(t, config('PreToolUse', [hook('gate')]), undefined, () => new Promise(r => finish = r), { permissionTimeoutMs: 30 });
  const result = await f.run(); assert(result.block && result.deferred); assert.equal(f.calls.length, 0);
  finish(true); await new Promise(r => setTimeout(r, 10));
  assert((await f.run()).block); assert.equal(f.reviews.length, 2); assert.equal(f.calls.length, 0);
});

test('concurrent approval waiters cancel independently and share one human decision', async t => {
  let finish, reviewSignal;
  const f = await fixture(t, config('PreToolUse', [hook('gate')]), undefined, (_request, sig) => { reviewSignal = sig; return new Promise(r => finish = r); });
  const first = new AbortController(); const a = f.run('PreToolUse', first.signal); const b = f.run();
  await until(() => finish); await new Promise(r => setTimeout(r, 30)); first.abort();
  assert((await a).deferred); assert.equal(reviewSignal.aborted, false); finish(true);
  assert.equal((await b).block, false); assert.equal(f.reviews.length, 1); assert.equal(f.calls.length, 1);
});

test('the final cancelled waiter withdraws approval and disposal cannot hang on an ignored provider signal', async t => {
  let reviewSignal;
  const f = await fixture(t, config('PreToolUse', [hook('gate')]), undefined, (_request, sig) => { reviewSignal = sig; return new Promise(() => {}); });
  const controller = new AbortController(); const pending = f.run('PreToolUse', controller.signal);
  await until(() => reviewSignal); controller.abort(); assert((await pending).deferred); assert(reviewSignal.aborted);
  const next = f.run(); await until(() => f.reviews.length === 2); await f.engine.dispose(); assert((await next).deferred);
  assert.equal(f.calls.length, 0);
});

test('a directory change during review invalidates the old grant and payload without running stale work', async t => {
  let finish;
  const f = await fixture(t, config('PreToolUse', [hook('gate')]), undefined, () => new Promise(r => finish = r));
  const nextDir = join(f.dir, 'other'); await mkdir(nextDir);
  const pending = f.run(); await until(() => finish); f.engine.attach('session', nextDir); finish(true);
  assert((await pending).deferred); assert.equal(f.calls.length, 0);
  const next = f.run(); await until(() => f.reviews.length === 2); finish(true); assert.equal((await next).block, false);
  assert.equal(f.calls[0].workdir, nextDir); assert.equal(f.reviews[1].cwd, nextDir);
});

test('invalid configuration arriving with approval returns an unavailable gate rather than a rejected promise', async t => {
  let finish;
  const f = await fixture(t, config('PreToolUse', [hook('gate')]), undefined, () => new Promise(r => finish = r));
  const pending = f.run(); await until(() => finish); await writeFile(f.file, '{'); finish(true);
  assert((await pending).deferred); assert.equal(f.calls.length, 0);
});

test('background output survives its triggering turn cancellation but revoke discards retained output', async t => {
  let finish;
  const f = await fixture(t, config('PostToolUse', [hook('async', { async: true })]), () => new Promise(r => finish = r));
  const controller = new AbortController(); await f.run('PostToolUse', controller.signal); controller.abort();
  assert.equal(f.calls[0].signal.aborted, false);
  finish(success('{"continue":false,"decision":"block","hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"later"}}'));
  let contexts = []; await until(() => { contexts = f.engine.takeContexts('session'); return contexts.length; }); assert.deepEqual(contexts, ['later']);
  await f.run('PostToolUse'); finish(success('{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"stale"}}'));
  await new Promise(r => setTimeout(r, 20)); f.engine.revoke('session'); assert.deepEqual(f.engine.takeContexts('session'), []);
});

test('background work is cancelled on detach and cannot publish to a recreated session with the same ID', async t => {
  let finish;
  const f = await fixture(t, config('PostToolUse', [hook('async', { async: true })]), request => new Promise(r => {
    finish = () => r(success('{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"old session"}}'));
    request.signal.addEventListener('abort', finish, { once: true });
  }));
  await f.run('PostToolUse'); const detach = f.engine.detach('session'); f.engine.attach('session', f.dir); await detach;
  assert.deepEqual(f.engine.takeContexts('session'), []); assert.equal(f.calls[0].signal.aborted, true);
  await f.run('PostToolUse'); assert.equal(f.reviews.length, 2); finish();
});

test('already cancelled operations neither execute commands nor request permission', async t => {
  const f = await fixture(t, config('PreToolUse', [hook('never')])); const controller = new AbortController(); controller.abort();
  assert((await f.run('PreToolUse', controller.signal)).deferred); assert.equal(f.reviews.length + f.calls.length, 0);
});

test('retained startup context is revision scoped; options are copied and immutable', async t => {
  const paths = [];
  const f = await fixture(t, config('SessionStart', [hook('start')]), () => success('startup'), undefined, { watchPaths: paths });
  paths.push('not-part-of-engine'); assert.deepEqual(f.engine.options.watchPaths, []);
  assert.throws(() => f.engine.options.watchPaths.push('mutate'));
  const output = await f.run('SessionStart'); f.engine.retainContexts('session', output); assert.deepEqual(f.engine.takeContexts('session'), ['startup']);
  f.engine.revoke('session'); f.engine.retainContexts('session', output); assert.deepEqual(f.engine.takeContexts('session'), []);
});

test('context spill preserves both ends and full output; zero means unlimited', async t => {
  const content = 'A'.repeat(60) + 'Z'.repeat(60);
  const f = await fixture(t, config('SessionStart', [hook('start', { additionalContextLimit: 10 })]), () => success(content));
  const output = (await f.run('SessionStart')).context[0]; assert(output.startsWith('A'.repeat(20))); assert(output.endsWith('Z'.repeat(20)));
  const file = output.match(/Full output: (.+)\]/)[1]; assert.equal(await readFile(file, 'utf8'), content); t.after(() => rm(file, { force: true }));
  const unlimited = await fixture(t, config('SessionStart', [hook('start', { additionalContextLimit: 0 })]), () => success(content));
  assert.equal((await unlimited.run('SessionStart')).context[0], content);
});

test('a refresh already reading the old cwd publishes only the new directory snapshot', async t => {
  const f = await fixture(t, config('PreToolUse', [hook('old')]), undefined, undefined, { configPaths: ['hooks.json'] });
  const nextDir = join(f.dir, 'new'); await mkdir(nextDir); await writeFile(join(nextDir, 'hooks.json'), JSON.stringify(config('PreToolUse', [hook('new')])));
  const refresh = f.engine.refresh('session'); f.engine.attach('session', nextDir);
  assert.deepEqual((await refresh).hooks.map(h => h.command), ['new']);
  await f.run(); assert.deepEqual(f.calls.map(c => c.command), ['new']); assert.equal(f.reviews[0].cwd, nextDir);
});

test('background queue overflow skips excess invocations and does not exceed total capacity', async t => {
  const f = await fixture(t, config('PostToolUse', Array.from({ length: 270 }, () => hook('async', { async: true }))));
  await f.run('PostToolUse'); await until(() => f.calls.length === 264);
  assert.equal(f.logs.filter(l => l.includes('queue is full')).length, 6);
});

test('tiny timeout fractions are rounded to a positive millisecond', async t => {
  const f = await fixture(t, config('PreToolUse', [hook('tiny', { timeout: 0.0001 })])); await f.run(); assert.equal(f.calls[0].timeoutMs, 1);
});

test('compact-only config is reviewed in an ordinary turn and manual maintenance never opens idle approval', async t => {
  const f = await fixture(t, config('PostCompact', [hook('post')]));
  const idle = await f.engine.run('session', 'PreCompact', { trigger: 'manual' }, ['manual'], signal(), true);
  assert(idle.deferred); assert.equal(f.reviews.length, 0); assert.equal(f.calls.length, 0);
  const start = await f.run('SessionStart'); assert.equal(start.block, false); assert.equal(f.reviews.length, 1); assert.equal(f.calls.length, 0);
  await f.engine.run('session', 'PreCompact', { trigger: 'manual' }, ['manual'], signal(), true);
  await f.engine.run('session', 'PostCompact', { trigger: 'manual' }, ['manual'], signal(), true);
  assert.equal(f.calls.length, 1); assert.equal(f.reviews.length, 1);
  f.engine.revoke('session'); await f.run('UserPromptSubmit'); assert.equal(f.reviews.length, 2);
});

test('async compact decisions cannot veto or inject context into the model', async t => {
  const f = await fixture(t, config('PreCompact', [hook('async', { async: true })]), () => success('{"continue":false,"hookSpecificOutput":{"hookEventName":"PreCompact","additionalContext":"ignored"}}'));
  const out = await f.run('PreCompact'); assert.equal(out.block || out.halt, false);
  await new Promise(r => setTimeout(r, 20)); assert.deepEqual(f.engine.takeContexts('session'), []);
});
