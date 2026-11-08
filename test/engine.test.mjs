import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HooksEngine } from '../dist/engine.js';
import { loadSnapshot } from '../dist/config.js';

const signal = () => new AbortController().signal;
const success = (stdout = '') => ({ exitCode: 0, stdout: { text: stdout }, stderr: { text: '' } });
const hook = (command, extra = {}) => ({ type: 'command', command, ...extra });
const config = (event, handlers) => ({ hooks: { [event]: [{ hooks: handlers }] } });
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
  await writeFile(f.file, '{'); assert((await f.run()).halt); assert.equal(f.calls.length, 1);
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
  assert.equal(one.hooks[0].env.PLUGIN_ROOT, root);
  await writeFile(join(root, 'hooks', 'script.mjs'), 'other');
  assert.notEqual((await loadSnapshot(root, { discover: false, pluginRoots: [root] })).fingerprint, one.fingerprint);
  await writeFile(join(root, 'plugin.json'), JSON.stringify({ extensions: { 'com.openai': { hooks: './../outside.json' } } }));
  await assert.rejects(loadSnapshot(root, { discover: false, pluginRoots: [root] }), /escapes root/);
});
