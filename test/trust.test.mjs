import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HooksEngine } from '../dist/engine.js';
import { PermanentTrust } from '../dist/trust.js';
const signal = () => new AbortController().signal;
async function fixture(t, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh trust ')), file = join(dir, 'hooks.json'), script = join(dir, 'guard.mjs'), data = join(dir, 'state');
  await writeFile(script, 'first version');
  await writeFile(file, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node ./guard.mjs' }] }] } }));
  const options = { discover: false, configPaths: [file], pluginDataRoot: data, shellFlavor: 'posix', ...extra };
  const calls = [], reviews = [], engines = [];
  const shell = { resolve: x => x, async execute(request) { calls.push(request); return { result: async () => ({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } }) }; } };
  const make = (authorize = async () => false, overrides = {}) => {
    const e = new HooksEngine(shell, async (request, sig) => { reviews.push(request); return authorize(request, sig); }, { ...options, ...overrides });
    engines.push(e); e.attach('s', dir); return e;
  };
  const run = (e, id = 's', approvedOnly = false) => e.run(id, 'PreToolUse', {}, ['Bash'], signal(), approvedOnly);
  const grant = async e => {
    const snapshot = await e.refresh('s');
    const request = { schema: 'dsh-hooks/approval-v1', scope: 'session', sessionId: 's', cwd: dir, fingerprint: snapshot.fingerprint, hooks: [] };
    await e.remember(request, signal()); return request;
  };
  t.after(async () => { await Promise.all(engines.map(e => e.dispose())); await rm(dir, { recursive: true, force: true }); });
  return { dir, file, script, data, options, calls, reviews, make, run, grant };
}
test('permanent approval survives session and engine restart without another prompt, including approved-only gates', async t => {
  const f = await fixture(t); const first = f.make(); await f.grant(first); await first.dispose();
  const restarted = f.make(); assert.equal((await f.run(restarted, 's', true)).block, false); assert.equal(f.reviews.length, 0);
  restarted.attach('new-session', f.dir); assert.equal((await f.run(restarted, 'new-session')).block, false); assert.equal(f.calls.length, 2);
  const status = await restarted.permissionStatus('new-session'); assert.equal(status.permanent, true);
  const records = await readdir(join(f.data, 'permissions')); assert.equal(records.length, 1);
  const saved = JSON.parse(await readFile(join(f.data, 'permissions', records[0]), 'utf8')); assert.equal(saved.schema, 'dsh-hooks/trust-v1'); assert.equal(saved.fingerprint, (await restarted.refresh('s')).fingerprint);
});
test('permission is bound to canonical directory, file/script content and execution policy', async t => {
  const f = await fixture(t); await f.grant(f.make());
  const other = join(f.dir, 'other'); await mkdir(other); const e = f.make(); e.attach('other', other);
  assert.equal((await f.run(e, 'other')).block, true);
  assert.equal((await f.run(f.make(undefined, { defaultTimeoutMs: 1000 }))).block, true);
  await writeFile(f.script, 'second version'); assert.equal((await f.run(e)).block, true);
  await f.grant(e); await writeFile(f.file, (await readFile(f.file, 'utf8')) + '\n'); assert.equal((await f.run(e)).block, true);
});
test('session revocation suppresses permanent reuse only in that session; a new session still reuses the saved grant', async t => {
  const f = await fixture(t); const e = f.make(); await f.grant(e); await f.run(e); e.revoke('s');
  assert.equal((await f.run(e)).block, true); e.attach('new', f.dir); assert.equal((await f.run(e, 'new')).block, false);
});
test('explicit session approval after revocation remains valid across several hooks even while durable permission exists', async t => {
  const f = await fixture(t); const e = f.make(async () => true); await f.grant(e); e.revoke('s');
  await f.run(e); await f.run(e); assert.equal(f.reviews.length, 1); assert.equal(f.calls.length, 2);
});
test('a declined session does not silently inherit a later permanent decision made in another session', async t => {
  const f = await fixture(t); const declined = f.make(); assert.equal((await f.run(declined)).block, true);
  await f.grant(f.make()); assert.equal((await f.run(declined)).block, true);
  declined.attach('new', f.dir); assert.equal((await f.run(declined, 'new')).block, false);
});
test('global revocation removes the durable record and cancels every attached session in that directory', async t => {
  const f = await fixture(t); const e = f.make(); await f.grant(e); e.attach('second', f.dir); await f.run(e); await f.run(e, 'second');
  await e.forget('s'); assert.equal((await e.permissionStatus('s')).permanent, false);
  assert.equal((await f.run(e)).block, true); assert.equal((await f.run(e, 'second')).block, true); assert.equal((await f.run(f.make())).block, true);
});
test('another engine observes a removed durable grant during refresh and cannot keep its cached approval', async t => {
  const f = await fixture(t); const first = f.make(), second = f.make(); await f.grant(first); await f.run(second);
  await first.forget('s'); await second.refresh('s'); assert.equal((await f.run(second, 's', true)).block, true);
});
test('cancelled and stale permanent answers cannot write a durable grant', async t => {
  const f = await fixture(t); const e = f.make(); const snapshot = await e.refresh('s');
  const request = { schema: 'dsh-hooks/approval-v1', scope: 'session', sessionId: 's', cwd: f.dir, fingerprint: snapshot.fingerprint, hooks: [] };
  const controller = new AbortController(); controller.abort(); await assert.rejects(e.remember(request, controller.signal));
  await writeFile(f.script, 'changed during review'); await assert.rejects(e.remember(request, signal())); assert.equal((await f.run(f.make())).block, true);
});
test('permission persistence failure cannot become an implicit session or permanent grant', async t => {
  const f = await fixture(t); const bad = join(f.dir, 'not-a-directory'); await writeFile(bad, 'file');
  const e = f.make(undefined, { permissionsDir: bad }); await assert.rejects(f.grant(e)); assert.equal((await f.run(e)).block, true);
});
test('malformed durable records fail closed and can be replaced by an explicit valid grant', async t => {
  const f = await fixture(t); const e = f.make(); await f.grant(e); const dir = join(f.data, 'permissions'); const [name] = await readdir(dir);
  await writeFile(join(dir, name), '{broken'); assert.equal((await f.run(e)).block, true); await f.grant(e); assert.equal((await f.run(e)).block, false);
});
test('cancel during the final commit removes the cancelled grant; pre-commit cancellation preserves an older grant', async t => {
  const f = await fixture(t); const trust = new PermanentTrust(f.options); const hash = 'a'.repeat(64), next = 'b'.repeat(64);
  await trust.remember(f.dir, hash, hash, async () => true);
  await assert.rejects(trust.remember(f.dir, next, next, async () => false)); assert.equal((await trust.get(f.dir)).policy, hash);
  let checks = 0; await assert.rejects(trust.remember(f.dir, next, next, async () => ++checks === 1)); assert.equal(await trust.get(f.dir), undefined);
  assert.deepEqual(await readdir(join(f.data, 'permissions')), []);
  checks = 0; await assert.rejects(trust.remember(f.dir, next, next, async () => { if (++checks > 1) throw new Error('invalid configuration'); return true; }));
  assert.equal(await trust.get(f.dir), undefined);
});
