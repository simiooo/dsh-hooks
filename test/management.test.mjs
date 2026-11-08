import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rename, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HooksManagement } from '../dist/management.js';
import { HooksEngine } from '../dist/engine.js';
import { loadSnapshot } from '../dist/config.js';

const configuration = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'guard', statusMessage: 'Review commands', timeout: 10 }] }], Stop: [{ hooks: [{ type: 'command', command: 'stop' }] }] } };
async function fixture(t, raw = configuration, extension = 'json') {
  const dir = await mkdtemp(join(tmpdir(), 'dsh hook settings ')), file = join(dir, `hooks.${extension}`), controls = join(dir, 'controls.json');
  await writeFile(file, typeof raw === 'string' ? raw : JSON.stringify(raw));
  const options = { discover: false, configPaths: [file], controlsPath: controls, shellFlavor: 'posix' };
  let changed = 0; const scopes = [dir];
  const manager = new HooksManagement(options, () => scopes, async () => { changed++; });
  t.after(async () => { await manager.dispose(); await rm(dir, { recursive: true, force: true }); });
  return { dir, file, controls, options, manager, scopes, changed: () => changed };
}

test('catalog groups real sources and retains unsupported events with disabled controls and diagnostics', async t => {
  const f = await fixture(t, { hooks: { ...configuration.hooks, PreCompact: [{ hooks: [{ type: 'command', command: 'capture', statusMessage: 'Capture memory' }] }], PostCompact: [{ hooks: [{ type: 'command', command: 'refresh' }] }] } });
  const data = await f.manager.catalog(); const source = data.sources[0];
  assert.equal(source.kind, 'custom'); assert.equal(source.path, f.file); assert.equal(source.hooks.length, 4); assert.equal(source.issues.length, 2);
  assert.deepEqual(source.hooks.filter(row => !row.supported).map(row => [row.event, row.enabled]), [['PreCompact', false], ['PostCompact', false]]);
  assert.equal(source.hooks[0].timeout, 10); assert.equal(source.hooks[0].name, 'Review commands');
  assert.equal((await loadSnapshot(f.dir, f.options)).hooks.length, 2);
  await assert.rejects(f.manager.setEnabled(data.scopeId, data.revision, source.hooks.at(-1).id, true), /cannot be enabled/);
});

test('persistent switches affect execution, survive reload and change the human review fingerprint', async t => {
  const f = await fixture(t); const original = await readFile(f.file, 'utf8');
  const initial = await f.manager.catalog(), id = initial.sources[0].hooks[0].id;
  const disabled = await f.manager.setEnabled(initial.scopeId, initial.revision, id, false);
  assert.equal(disabled.sources[0].hooks[0].enabled, false); assert.notEqual(disabled.revision, initial.revision);
  assert.deepEqual((await loadSnapshot(f.dir, f.options)).hooks.map(h => h.command), ['stop']);
  assert.equal(await readFile(f.file, 'utf8'), original, 'a switch must not rewrite Codex JSON');
  const reopened = new HooksManagement(f.options, () => [f.dir], async () => {}); t.after(() => reopened.dispose());
  assert.equal((await reopened.catalog()).sources[0].hooks[0].enabled, false);
  const enabled = await reopened.setEnabled(disabled.scopeId, disabled.revision, id, true); assert.equal(enabled.sources[0].hooks[0].enabled, true);
  assert.equal((await loadSnapshot(f.dir, f.options)).hooks.length, 2); assert.equal(f.changed(), 1);
});

test('stale and concurrent mutations cannot overwrite a newer switch or source revision', async t => {
  const f = await fixture(t), data = await f.manager.catalog(), hooks = data.sources[0].hooks;
  const results = await Promise.allSettled(hooks.map(h => f.manager.setEnabled(data.scopeId, data.revision, h.id, false)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.match(String(results.find(r => r.status === 'rejected').reason), /Hooks changed/);
  await assert.rejects(f.manager.writeSource(data.scopeId, data.revision, data.sources[0].id, JSON.stringify({ hooks: {} })), /Hooks changed/);
  assert.equal(await readFile(f.file, 'utf8'), JSON.stringify(configuration));
});

test('JSON and TOML source editing is revision checked, validates before writing and preserves exact text', async t => {
  for (const extension of ['json', 'toml']) {
    const original = extension === 'json' ? configuration : '# retain comment\nother_setting = true\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "stop"\n';
    const f = await fixture(t, original, extension), data = await f.manager.catalog(), source = data.sources[0];
    const file = await f.manager.readSource(data.scopeId, data.revision, source.id); assert.equal(file.path, await realpath(f.file)); assert.equal(file.format, extension);
    await assert.rejects(f.manager.writeSource(data.scopeId, data.revision, source.id, '{'), /./); assert.equal(await readFile(f.file, 'utf8'), file.content);
    const next = extension === 'json' ? JSON.stringify({ ...configuration, preserved: { nested: true } }, null, 2) : file.content.replace('command = "stop"', 'command = "new stop"');
    await f.manager.writeSource(data.scopeId, data.revision, source.id, next); assert.equal(await readFile(f.file, 'utf8'), next);
    await assert.rejects(f.manager.writeSource(data.scopeId, data.revision, source.id, file.content), /Hooks changed/);
  }
});

test('malformed sources remain visible and repairable without letting the engine use the old config', async t => {
  const f = await fixture(t, '{'), data = await f.manager.catalog();
  assert.equal(data.sources[0].errors.length, 1); assert.equal(data.sources[0].hooks.length, 0);
  await assert.rejects(loadSnapshot(f.dir, f.options));
  const repaired = await f.manager.writeSource(data.scopeId, data.revision, data.sources[0].id, JSON.stringify(configuration));
  assert.equal(repaired.sources[0].errors.length, 0); assert.equal(repaired.sources[0].hooks.length, 2);
});

test('unknown source/scope, malformed state and closed management never grant arbitrary filesystem writes', async t => {
  const f = await fixture(t), data = await f.manager.catalog();
  await assert.rejects(f.manager.catalog('forged-directory'), /no longer available/);
  await assert.rejects(f.manager.readSource(data.scopeId, data.revision, '0'.repeat(64)), /Unknown hook source/);
  await assert.rejects(f.manager.writeSource(data.scopeId, data.revision, '../outside', '{}'), /Unknown hook source/);
  await writeFile(f.controls, 'null'); const broken = await f.manager.catalog(); assert(broken.issues.some(issue => issue.includes('controls unavailable')));
  await assert.rejects(loadSnapshot(f.dir, f.options));
  await assert.rejects(f.manager.setEnabled(broken.scopeId, broken.revision, broken.sources[0].hooks[0].id, false), /Repair/);
  await f.manager.dispose(); await assert.rejects(f.manager.catalog(), /closed/);
});

test('switching off a live hook cancels its process and requires a new review when reenabled', async t => {
  const f = await fixture(t); const calls = [], reviews = [];
  let started;
  const entered = new Promise(r => started = r);
  const engine = new HooksEngine({ resolve: x => x, async execute(spec) { calls.push(spec); started(); return { result: () => new Promise(r => spec.signal.addEventListener('abort', () => r({ exitCode: 0, aborted: true, stdout: { text: '' }, stderr: { text: '' } }), { once: true })) }; } }, async request => { reviews.push(request); return true; }, f.options);
  engine.attach('s', f.dir); t.after(() => engine.dispose());
  const manager = new HooksManagement(f.options, () => [f.dir], async () => { engine.revoke('s'); await engine.refresh('s'); }); t.after(() => manager.dispose());
  const pending = engine.run('s', 'PreToolUse', {}, ['Bash'], new AbortController().signal); await entered;
  const data = await manager.catalog(); const disabled = await manager.setEnabled(data.scopeId, data.revision, data.sources[0].hooks[0].id, false);
  assert((await pending).deferred); assert(calls[0].signal.aborted);
  const skipped = await engine.run('s', 'PreToolUse', {}, ['Bash'], new AbortController().signal); assert.equal(skipped.block, false); assert.equal(calls.length, 1);
  await manager.setEnabled(disabled.scopeId, disabled.revision, disabled.sources[0].hooks[0].id, true);
  const controller = new AbortController(); const next = engine.run('s', 'PreToolUse', {}, ['Bash'], controller.signal);
  const deadline = Date.now() + 3000; while (calls.length < 2) { assert(Date.now() < deadline); await new Promise(r => setTimeout(r, 5)); } controller.abort(); await next;
  assert.equal(reviews.length, 2); assert.notEqual(reviews[0].fingerprint, reviews[1].fingerprint);
});

test('an empty install can create its known user configuration without overwriting a newly created file', async t => {
  const f = await fixture(t); await mkdir(join(f.dir, '.git')); const home = join(f.dir, 'empty-home');
  const manager = new HooksManagement({ codexHome: home, controlsPath: f.controls }, () => [f.dir], async () => {}); t.after(() => manager.dispose());
  const data = await manager.catalog(), source = data.sources[0]; assert.equal(source.missing, true); assert.equal(source.kind, 'user'); assert.equal(source.hooks.length, 0);
  const seed = await manager.readSource(data.scopeId, data.revision, source.id); assert.deepEqual(JSON.parse(seed.content), { hooks: {} });
  await manager.writeSource(data.scopeId, data.revision, source.id, JSON.stringify(configuration));
  assert.equal(await readFile(join(home, 'hooks.json'), 'utf8'), JSON.stringify(configuration));
  await assert.rejects(manager.writeSource(data.scopeId, data.revision, source.id, '{"hooks":{}}'), /Hooks changed/);
});

test('inline plugin controls share executable IDs and manifest edits retain root confinement', async t => {
  const f = await fixture(t), root = join(f.dir, 'plugin'), metadata = join(root, '.codex-plugin'); await mkdir(metadata, { recursive: true });
  const path = join(metadata, 'plugin.json'); const manifest = { extensions: { 'com.openai': { hooks: configuration } } }; await writeFile(path, JSON.stringify(manifest));
  const options = { discover: false, pluginRoots: [root], controlsPath: f.controls };
  const manager = new HooksManagement(options, () => [f.dir], async () => {}); t.after(() => manager.dispose());
  const data = await manager.catalog(); const source = data.sources[0]; assert.equal(source.path, await realpath(path));
  assert.equal(source.hooks[0].id, (await loadSnapshot(f.dir, options)).hooks[0].id);
  await assert.rejects(manager.writeSource(data.scopeId, data.revision, source.id, JSON.stringify({ hooks: './../outside.json' })), /must start with|escapes/);
  assert.equal(await readFile(path, 'utf8'), JSON.stringify(manifest));
  await manager.setEnabled(data.scopeId, data.revision, source.hooks[0].id, false); assert.deepEqual((await loadSnapshot(f.dir, options)).hooks.map(h => h.command), ['stop']);
});

test('same-content directory link retargeting invalidates the editor and cannot redirect a save', async t => {
  const f = await fixture(t), first = join(f.dir, 'first'), second = join(f.dir, 'second'), alias = join(f.dir, 'alias');
  await mkdir(first); await mkdir(second);
  for (const path of [first, second]) await writeFile(join(path, 'hooks.json'), JSON.stringify(configuration));
  const type = process.platform === 'win32' ? 'junction' : 'dir'; await symlink(first, alias, type);
  const manager = new HooksManagement({ ...f.options, configPaths: [join(alias, 'hooks.json')] }, () => [f.dir], async () => {}); t.after(() => manager.dispose());
  const initial = await manager.catalog(); const editor = await manager.readSource(initial.scopeId, initial.revision, initial.sources[0].id);
  assert.equal(editor.path, await realpath(join(first, 'hooks.json')));
  await rename(alias, join(f.dir, 'old-alias')); await symlink(second, alias, type);
  const current = await manager.catalog(); assert.notEqual(current.revision, initial.revision);
  await assert.rejects(manager.writeSource(initial.scopeId, initial.revision, initial.sources[0].id, '{"hooks":{}}'), /Hooks changed/);
  assert.equal(await readFile(join(second, 'hooks.json'), 'utf8'), JSON.stringify(configuration));
});
