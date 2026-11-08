import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

let dom, createRoot, Settings, copy, catalog, failure, written = [], switched = [], reads = 0;
const scopeId = 'd'.repeat(64), sourceId = 'e'.repeat(64);
const sample = () => ({ revision: 'f'.repeat(64), scopeId, scopes: [{ id: scopeId, cwd: '/repo' }], issues: [], sources: [{
  id: sourceId, kind: 'user', path: '/home/.codex/hooks.json', errors: [], issues: ['Unsupported event PreModelRequest', 'Ignoring additionalContextLimit for Stop'], hooks: [
    { id: 'a'.repeat(64), event: 'SessionStart', name: 'Nuto · Restore context', command: 'node ./context.mjs', timeout: 600, async: false, enabled: true, supported: true },
    { id: 'b'.repeat(64), event: 'PreModelRequest', name: 'Nuto · Capture memory', command: 'node ./capture.mjs', timeout: 600, async: false, enabled: false, supported: false, problem: 'Unsupported event PreModelRequest' },
  ],
}] });
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' }); globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client'));
  let plugin;
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load(def) { plugin = def.factory(() => React); } } }, document, setTimeout, clearTimeout });
  const ctx = {
    effect: init => init(), inject: (_deps, init) => init(ctx), locale: { register(_ns, dictionaries) { copy = dictionaries; return () => {}; } },
    slots: { inject(_name, init) { init(); }, register(spec, Component) { if (spec.name === 'plugins.detail.section') Settings = Component; return () => {}; } },
    remote: { async $mount(contribution) {
      assert.equal(contribution.descriptors.length, 9);
      const codec = contribution.descriptors.find(d => d.method === 'setEnabled').parameters[0].codec.create();
      assert.throws(() => codec.parse({ scopeId, revision: 'f'.repeat(64), id: 'a'.repeat(64), enabled: 'false' }));
      assert.equal(codec.parse({ scopeId, revision: 'f'.repeat(64), id: 'a'.repeat(64), enabled: false }).enabled, false);
    }, dshHooksManagement: {
      async catalog() { reads++; return { ok: true, value: structuredClone(catalog) }; },
      async setEnabled(request) {
        switched.push(request); if (failure) return { ok: false, error: { message: failure } };
        catalog.sources[0].hooks.find(h => h.id === request.id).enabled = request.enabled; catalog.revision = '1'.repeat(64);
        return { ok: true, value: structuredClone(catalog) };
      },
      async readSource(request) { return { ok: true, value: { path: catalog.sources[0].path, revision: request.revision, content: '{"hooks":{}}' } }; },
      async writeSource(request) { written.push(request); if (failure) return { ok: false, error: { message: failure } }; return { ok: true, value: structuredClone(catalog) }; },
    } },
  }; await plugin.apply(ctx);
});
after(() => { dom.window.close(); delete globalThis.window; delete globalThis.document; });
async function mount(subject = { kind: 'bundle', pkg: { name: '@simooom/dsh-hooks' } }) {
  catalog = sample(); failure = undefined; written = []; switched = []; reads = 0;
  const container = document.createElement('main'); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(React.createElement(Settings, { subject, t: key => copy.zh[key] })));
  return { container, async cleanup() { await act(async () => root.unmount()); container.remove(); } };
}
const click = async button => act(async () => button.click());
const open = view => click(view.container.querySelector('.dsh-hooks-source'));
async function change(textarea, value) {
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, value); textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
}

test('contributes only to its own bundle/row detail; unrelated plugins cause no API reads', async () => {
  const view = await mount({ kind: 'bundle', pkg: { name: 'other' } });
  try { assert.equal(view.container.textContent, ''); assert.equal(reads, 0); } finally { await view.cleanup(); }
});

test('overview matches source cards, counts, problems and explicit refresh', async () => {
  const view = await mount();
  try {
    assert(view.container.textContent.includes('钩子')); assert(view.container.textContent.includes('用户配置')); assert(view.container.textContent.includes('2 个钩子')); assert(view.container.textContent.includes('2 个问题'));
    await click(view.container.querySelector('[aria-label=刷新钩子]')); assert.equal(reads, 2);
    await open(view); assert(view.container.querySelector('dialog[open]')); assert(view.container.textContent.includes('所有项目')); assert(view.container.textContent.includes('当前版本未支持 PreModelRequest'));
  } finally { await view.cleanup(); }
});

test('event sections expand command/timeout details and unsupported switches cannot be clicked', async () => {
  const view = await mount();
  try {
    await open(view); assert.equal(view.container.querySelectorAll('.dsh-hooks-event').length, 2);
    await click(view.container.querySelector('[aria-label=展开钩子详情]'));
    assert(view.container.querySelector('dl').textContent.includes('node ./context.mjs')); assert(view.container.querySelector('dl').textContent.includes('600秒'));
    const unsupported = [...view.container.querySelectorAll('[role=switch]')].find(button => button.disabled);
    await click(unsupported); assert.equal(switched.length, 0); assert.equal(unsupported.getAttribute('aria-checked'), 'false');
  } finally { await view.cleanup(); }
});

test('switches submit once with the observed scope/version and show only confirmed state', async () => {
  const view = await mount();
  try {
    await open(view); const button = view.container.querySelector('[role=switch]');
    await act(async () => { button.click(); button.click(); });
    assert.equal(switched.length, 1); assert.equal(switched[0].enabled, false); assert.equal(switched[0].scopeId, scopeId); assert.equal(switched[0].revision, 'f'.repeat(64));
    assert.equal(view.container.querySelector('[role=switch]').getAttribute('aria-checked'), 'false');
  } finally { await view.cleanup(); }
});

test('a stale save leaves the switch unchanged and displays a refresh instruction', async () => {
  const view = await mount();
  try {
    await open(view); failure = 'Hooks changed. Refresh before saving.';
    await click(view.container.querySelector('[role=switch]'));
    assert.equal(view.container.querySelector('[role=switch]').getAttribute('aria-checked'), 'true'); assert(view.container.textContent.includes('配置已变化'));
    await act(async () => new Promise(r => setTimeout(r, 1550))); assert(view.container.textContent.includes('配置已变化'), 'background polling must not hide the failed action');
  } finally { await view.cleanup(); }
});

test('source editor preserves a failed draft and explicitly saves valid changes without running commands', async () => {
  const view = await mount();
  try {
    await open(view); await click(view.container.querySelector('[aria-label=编辑配置]'));
    const textarea = view.container.querySelector('textarea'); assert.equal(textarea.value, '{"hooks":{}}');
    await change(textarea, '{"hooks":{"Stop":[]}}'); failure = 'Invalid configuration';
    await click([...view.container.querySelectorAll('button')].find(b => b.textContent === '保存'));
    assert.equal(written.length, 1); assert.equal(textarea.value, '{"hooks":{"Stop":[]}}'); assert(view.container.textContent.includes('Invalid configuration'));
    failure = undefined; await click([...view.container.querySelectorAll('button')].find(b => b.textContent === '保存'));
    assert.equal(written.length, 2); assert.equal(written[1].sourceId, sourceId); assert.equal(view.container.querySelector('textarea'), null); assert.equal(switched.length, 0);
  } finally { await view.cleanup(); }
});

test('hook titles and diagnostics are text, and native dialog cancellation restores the source card', async () => {
  const view = await mount();
  try {
    catalog.sources[0].hooks[0].name = '<img src=x onerror=alert(1)>';
    await click(view.container.querySelector('[aria-label=刷新钩子]')); await open(view);
    assert.equal(view.container.querySelector('img'), null); assert(view.container.textContent.includes('<img src=x'));
    await act(async () => view.container.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { bubbles: true, cancelable: true })));
    assert.equal(view.container.querySelector('dialog'), null); assert(view.container.querySelector('.dsh-hooks-source'));
  } finally { await view.cleanup(); }
});

test('unknown event names remain readable without looking up arbitrary locale keys', async () => {
  const view = await mount();
  try {
    catalog.sources[0].hooks.push({ ...catalog.sources[0].hooks[1], id: 'c'.repeat(64), event: 'toString', name: 'Unknown hook' });
    await click(view.container.querySelector('[aria-label=刷新钩子]')); await open(view);
    assert(view.container.textContent.includes('toString')); assert(view.container.textContent.includes('当前 Harness 版本未支持'));
  } finally { await view.cleanup(); }
});
