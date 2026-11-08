import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HooksEngine } from '../dist/engine.js';
import { HooksManagement } from '../dist/management.js';
import { PolicyStore } from '../dist/policy.js';
import { PermanentTrust } from '../dist/trust.js';
import { sha } from '../dist/config.js';

const signal = () => new AbortController().signal;
const success = text => ({ exitCode: 0, stdout: { text }, stderr: { text: '' } });
async function until(check) { const deadline = Date.now() + 3000; while (!check()) { assert(Date.now() < deadline, 'operation did not settle'); await new Promise(r => setTimeout(r, 5)); } }
async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh hierarchy ')), a = join(root, 'a'), b = join(root, 'b'), data = join(root, 'state');
  for (const dir of [a, b]) await mkdir(join(dir, '.git'), { recursive: true });
  const file = join(root, 'hooks.json'), scripts = [join(root, 'one.mjs'), join(root, 'two.mjs')];
  for (const script of scripts) await writeFile(script, 'first');
  const handlers = scripts.map((script, index) => ({ type: 'command', id: `hook-${index}`, command: `node "${script.replaceAll('\\', '/')}"`, statusMessage: `Hook ${index + 1}`, ...(extra.async ? { async: true } : {}) }));
  const configuration = { hooks: { [extra.event ?? 'UserPromptSubmit']: [{ hooks: handlers }] } };
  await writeFile(file, JSON.stringify(configuration));
  const options = { discover: false, configPaths: [file], pluginDataRoot: data, shellFlavor: 'posix', ...extra.options };
  const calls = [], engines = [], managers = [];
  const make = () => {
    const engine = new HooksEngine({ resolve: x => x, async execute(spec) { calls.push(spec); return { result: async () => extra.execute ? extra.execute(spec) : success(spec.command.includes('one.mjs') ? 'one' : 'two') }; } }, async () => 'deferred', options);
    engine.enableHierarchy(); engine.attach('a', a); engine.attach('a2', a); engine.attach('b', b); engines.push(engine);
    return engine;
  };
  const engine = make();
  const manager = new HooksManagement(options, () => [a, b], async () => {}, engine); managers.push(manager);
  const catalog = () => manager.catalog();
  const set = async (index, choice, scope = 'global') => { const c = await catalog(); return manager.setPermission(c.scopeId, c.revision, c.permissions.policyRevision, c.permissions.hooks[index].id, scope, choice); };
  const defaults = async enabled => { const c = await catalog(); return manager.setDefaultPermission(c.scopeId, c.revision, c.permissions.policyRevision, enabled); };
  const session = async (sid, index, choice) => { const p = (await engine.permissionStatus(sid)).policy; return engine.setSessionPolicy(sid, p.revision, p.hooks[index].id, choice); };
  const run = (sid = 'a') => engine.run(sid, extra.event ?? 'UserPromptSubmit', {}, ['Bash'], signal());
  t.after(async () => { await Promise.all(managers.map(m => m.dispose())); await Promise.all(engines.map(e => e.dispose())); await rm(root, { recursive: true, force: true }); });
  return { root, a, b, data, file, scripts, configuration, options, engine, make, manager, calls, catalog, set, defaults, session, run };
}

test('per-hook global/project/session inheritance is live, reversible and isolated between projects and sessions', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.run()).context, []); assert.equal((await f.run()).block, false);
  await f.set(0, 'allow'); assert.deepEqual((await f.run()).context, ['one']); assert.deepEqual((await f.run('b')).context, ['one']);
  await f.set(0, 'deny', 'project'); assert.deepEqual((await f.run()).context, []); assert.deepEqual((await f.run('a2')).context, []); assert.deepEqual((await f.run('b')).context, ['one']);
  await f.session('a', 0, 'allow'); assert.deepEqual((await f.run()).context, ['one']); assert.deepEqual((await f.run('a2')).context, []);
  assert.equal((await f.engine.permissionStatus('a')).policy.hooks[0].from, 'session');
  await f.session('a', 0, 'inherit'); assert.equal((await f.engine.permissionStatus('a')).policy.hooks[0].from, 'project');
  await f.set(0, 'inherit', 'project'); assert.deepEqual((await f.run()).context, ['one']);
  assert.equal((await f.engine.permissionStatus('a')).policy.hooks[0].from, 'global');
  const restarted = f.make(); assert.deepEqual((await restarted.run('b', 'UserPromptSubmit', {}, [], signal())).context, ['one']);
});

test('global default covers reviewed versions only; local exceptions and explicit rules survive switching it off', async t => {
  const f = await fixture(t); await f.defaults(true);
  assert.deepEqual((await f.run('b')).context, ['one', 'two']); await f.session('a', 1, 'deny');
  assert.deepEqual((await f.run()).context, ['one']);
  await writeFile(f.scripts[0], 'second');
  assert.deepEqual((await f.run('b')).context, ['two']);
  const changed = (await f.engine.permissionStatus('b')).policy.hooks;
  assert(changed[0].reviewRequired); assert.equal(changed[1].effective, 'allow');
  await f.set(0, 'allow'); await f.defaults(false);
  assert.deepEqual((await f.run('b')).context, ['one']); assert.equal((await f.engine.permissionStatus('a')).policy.hooks[1].effective, 'deny');
  f.configuration.hooks.UserPromptSubmit[0].hooks.push({ type: 'command', command: 'new-hook' }); await writeFile(f.file, JSON.stringify(f.configuration));
  assert.equal((await f.engine.permissionStatus('a')).policy.hooks[2].effective, 'ask');
});

test('display names and ordering do not reset grants; only the changed hook version needs review', async t => {
  const f = await fixture(t); await f.set(0, 'allow'); await f.set(1, 'allow');
  const before = (await f.catalog()).permissions.hooks;
  f.configuration.hooks.UserPromptSubmit[0].hooks[0].statusMessage = 'Renamed'; f.configuration.hooks.UserPromptSubmit[0].hooks.reverse();
  await writeFile(f.file, JSON.stringify(f.configuration));
  const after = (await f.catalog()).permissions.hooks;
  for (const row of before) assert.equal(after.find(next => next.id === row.id).version, row.version);
  assert.deepEqual((await f.run()).context, ['two', 'one']);
  await writeFile(f.scripts[0], 'changed'); assert.deepEqual((await f.run()).context, ['two']);
});

test('stale policy, instance, directory and disposed-session mutations cannot create permission', async t => {
  const f = await fixture(t), c = await f.catalog(), status = (await f.engine.permissionStatus('a')).policy;
  await f.set(0, 'deny');
  await assert.rejects(f.manager.setPermission(c.scopeId, c.revision, c.permissions.policyRevision, c.permissions.hooks[1].id, 'global', 'allow'), /permissions changed/);
  await assert.rejects(f.engine.setSessionPolicy('a', status.revision, status.hooks[0].id, 'allow'), /permissions changed/);
  const current = (await f.engine.permissionStatus('a')).policy;
  await assert.rejects(f.engine.setSessionPolicy('b', current.revision, current.hooks[0].id, 'allow'), /permissions changed/);
  f.engine.attach('a', f.b); await assert.rejects(f.engine.setSessionPolicy('a', current.revision, current.hooks[0].id, 'allow'), /permissions changed/);
  await f.engine.detach('a'); await assert.rejects(f.engine.setSessionPolicy('a', current.revision, current.hooks[0].id, 'allow'), /ended/);
  await assert.rejects(f.manager.setPermission(c.scopeId, c.revision, c.permissions.policyRevision, c.permissions.hooks[1].id, 'session', 'allow'), /Invalid/);
});

test('session overrides disappear on close; subdirectories share project rules and worktrees remain separate', async t => {
  const f = await fixture(t), sub = join(f.a, 'nested'); await mkdir(sub);
  await f.set(0, 'allow'); await f.set(1, 'deny', 'project'); await f.session('a', 1, 'allow');
  f.engine.attach('nested', sub); assert.equal((await f.engine.permissionStatus('nested')).policy.hooks[1].from, 'project');
  await f.engine.detach('a'); f.engine.attach('a', f.a);
  assert.equal((await f.engine.permissionStatus('a')).policy.hooks[1].effective, 'deny');
  assert.equal((await f.engine.permissionStatus('b')).policy.hooks[1].effective, 'ask');
  const alias = join(f.root, 'alias'); await symlink(sub, alias, process.platform === 'win32' ? 'junction' : 'dir');
  f.engine.attach('alias', alias); assert.equal((await f.engine.permissionStatus('alias')).policy.hooks[1].from, 'project');
});

test('revocation cancels only its hook and discards its late output; other background work survives reload', async t => {
  const pending = [];
  const f = await fixture(t, { async: true, execute: spec => new Promise(resolve => { pending.push({ spec, resolve }); spec.signal.addEventListener('abort', () => resolve(success('old output')), { once: true }); }) });
  await f.defaults(true); await f.run(); await until(() => pending.length === 2);
  const first = pending.find(p => p.spec.command.includes('one.mjs')), second = pending.find(p => p.spec.command.includes('two.mjs'));
  await f.set(0, 'deny'); assert(first.spec.signal.aborted); assert(!second.spec.signal.aborted);
  await writeFile(f.scripts[0], 'reload only first'); await f.engine.refresh('a'); assert(!second.spec.signal.aborted);
  second.resolve(success('kept background')); await until(() => f.engine.takeContexts('a').includes('kept background'));
  assert.deepEqual(f.engine.takeContexts('a'), []);
});

test('settings revocation is observed by another Host and drops context retained before model admission', async t => {
  const f = await fixture(t); await f.set(0, 'allow'); const second = f.make();
  const out = await second.run('a', 'UserPromptSubmit', {}, [], signal()); second.retainContexts('a', out);
  await f.set(0, 'deny'); assert.deepEqual(await second.collectContexts('a'), []);
  assert.deepEqual((await second.run('a', 'UserPromptSubmit', {}, [], signal())).context, []);
});

test('a revoked queued hook is skipped without stalling the remaining background queue', async t => {
  const pending = [];
  const f = await fixture(t, { async: true, execute: spec => new Promise(resolve => {
    pending.push({ spec, resolve }); spec.signal.addEventListener('abort', () => resolve(success('')), { once: true });
  }) });
  f.configuration.hooks.UserPromptSubmit[0].hooks = Array.from({ length: 10 }, (_, index) => ({ type: 'command', id: `queued-${index}`, command: `worker-${index}`, async: true }));
  await writeFile(f.file, JSON.stringify(f.configuration)); await f.defaults(true); await f.run(); await until(() => pending.length === 8);
  await f.set(8, 'deny'); pending[0].resolve(success(''));
  await until(() => pending.length === 9); assert.equal(pending[8].spec.command, 'worker-9');
  for (const row of pending) row.resolve(success(''));
});

test('corrupt configuration/policy and permission storage failures skip hooks without blocking native execution', async t => {
  const f = await fixture(t, { event: 'PreToolUse' }); await f.defaults(true);
  const path = join(f.data, 'permissions', 'policy.json'), saved = await readFile(path, 'utf8');
  await writeFile(path, 'broken'); let out = await f.run(); assert.equal(out.block, false); assert.equal(out.halt, false); assert.deepEqual(out.context, []);
  assert((await f.catalog()).permissionProblem); await writeFile(path, saved);
  await writeFile(f.file, 'broken'); out = await f.run(); assert.equal(out.block, false); assert.equal(out.halt, false);
  const bad = join(f.root, 'bad-store'); await writeFile(bad, 'file');
  const g = await fixture(t, { options: { permissionsDir: bad } }); assert.equal((await g.run()).block, false); await assert.rejects(g.defaults(true));
});

test('old directory grants remain confined to that exact directory and snapshot', async t => {
  const f = await fixture(t), snapshot = await f.engine.refresh('a');
  const oldHooks = snapshot.hooks.map(hook => ({ id: hook.legacyControlId, event: hook.event, command: hook.command, async: hook.async, source: hook.source, env: hook.env,
    additionalContextLimit: hook.additionalContextLimit, ...(hook.matcher === undefined ? {} : { matcher: hook.matcher }), ...(hook.timeout === undefined ? {} : { timeout: hook.timeout }), ...(hook.statusMessage === undefined ? {} : { statusMessage: hook.statusMessage }) }));
  const oldPolicy = sha(JSON.stringify([snapshot.fingerprint, oldHooks, 'posix', 600_000, 1_048_576]));
  await new PermanentTrust(f.options).remember(f.a, snapshot.fingerprint, oldPolicy, async () => true);
  assert.equal((await f.engine.permissionStatus('a2')).policy.hooks[0].from, 'legacy');
  assert.equal((await f.engine.permissionStatus('b')).policy.hooks[0].effective, 'ask');
  const sub = join(f.a, 'sub'); await mkdir(sub); f.engine.attach('sub', sub); assert.equal((await f.engine.permissionStatus('sub')).policy.hooks[0].effective, 'ask');
});

test('a disposed plugin cannot publish new durable permissions from an old settings view', async t => {
  const f = await fixture(t), c = await f.catalog(); await f.engine.dispose();
  await assert.rejects(f.manager.setDefaultPermission(c.scopeId, c.revision, c.permissions.policyRevision, true), /disposed/);
  const document = await new PolicyStore(f.options).read(); assert.equal(document.revision, 'none'); assert.equal(document.defaultAllow, false);
});

test('concurrent Host policy writers reject stale state; cancelled commits roll back and retry remains possible', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh policy atomic ')); t.after(() => rm(root, { recursive: true, force: true }));
  const options = { pluginDataRoot: root }, first = new PolicyStore(options), second = new PolicyStore(options);
  const result = await Promise.allSettled([first.update('none', d => { d.defaultAllow = true; }, async () => true), second.update('none', d => { d.defaultAllow = false; }, async () => true)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.equal(result.filter(r => r.status === 'rejected').length, 1);
  const before = await first.read(); let checks = 0;
  await assert.rejects(first.update(before.revision, d => { d.defaultAllow = !d.defaultAllow; }, async () => ++checks < 3), /withdrawn/);
  assert.deepEqual(await first.read(), before);
  await first.update(before.revision, d => { d.defaultAllow = !d.defaultAllow; }, async () => true);
});
