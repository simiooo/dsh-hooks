import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

let plugin, copy, document, dom, createRoot;
const registrations = new Map();
let requests = [], answers = [], revoked = [];
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client')); document = dom.window.document;
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(definition) { plugin = definition.factory(name => { assert.equal(name, 'react'); return React; }); } } }, setTimeout, clearTimeout,
  });
  const ctx = {
    effect: init => init(), inject: (_deps, init) => init(ctx),
    locale: { register(_ns, dictionaries) { copy = dictionaries; return () => {}; } },
    slots: { inject(_name, init) { init(); }, register(spec, component) { registrations.set(spec.name, { spec, component }); return () => {}; } },
    remote: {
      async $mount(contribution) {
        assert.equal(contribution.descriptors.length, 3);
        for (const descriptor of contribution.descriptors) {
          const codec = descriptor.parameters[0].codec;
          assert.equal(codec.mode, 'strict');
          assert.throws(() => codec.create().parse({ sessionId: 's1', unexpected: true }));
          if (descriptor.method !== 'answer') assert.equal(codec.create().parse({ sessionId: 's1' }).sessionId, 's1');
        }
        return () => {};
      },
      dshHooksPermissions: {
        async list({ sessionId }) { return { ok: true, value: { requests: requests.filter(r => r.sessionId === sessionId) } }; },
        async answer(request) { answers.push(request); requests = []; return { ok: true, value: { accepted: true } }; },
        async revoke({ sessionId }) { revoked.push(sessionId); return { ok: true, value: { revoked: true } }; },
      },
    },
  };
  await plugin.apply(ctx);
});
after(() => { dom.window.close(); delete globalThis.window; delete globalThis.document; });
const request = (extra = {}) => ({ id: 'request-1', schema: 'dsh-hooks/approval-v1', sessionId: 's1', cwd: '/repo', fingerprint: 'a'.repeat(64), scope: 'session', hooks: [{ event: 'PreToolUse', command: 'node ./guard.mjs', source: '/repo/.codex/hooks.json' }], ...extra });
async function mount(rows = [request()], sessionId = 's1', slot = 'conversation.input.dock') {
  requests = rows; answers = []; revoked = [];
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const Component = registrations.get(slot).component;
  await act(async () => root.render(React.createElement('div', null, React.createElement(Component, { sessionId, t: key => copy.zh[key] }), React.createElement('textarea', { 'aria-label': 'native message', defaultValue: 'kept draft' }))));
  return { container, async cleanup() { await act(async () => root.unmount()); container.remove(); } };
}
test('registers additive public slots without replacing the native composer', () => {
  assert(registrations.has('conversation.input.dock')); assert(registrations.has('conversation.input.right'));
  assert(!registrations.has('conversation.composer')); assert(!registrations.has('conversation.composer.bar'));
});
test('permission is above the editor; commands and config paths are reviewable', async () => {
  const view = await mount();
  try {
    assert(view.container.querySelector('section').compareDocumentPosition(view.container.querySelector('textarea')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    const toggle = view.container.querySelector('[aria-expanded]'); await act(async () => toggle.click());
    assert.equal(toggle.getAttribute('aria-expanded'), 'true'); assert(view.container.textContent.includes('node ./guard.mjs')); assert(view.container.textContent.includes('/repo/.codex/hooks.json'));
    assert.equal(view.container.querySelector('textarea').value, 'kept draft');
  } finally { await view.cleanup(); }
});
test('session grant is single-shot; typing Enter in the editor never approves', async () => {
  const view = await mount();
  try {
    await act(async () => view.container.querySelector('textarea').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.equal(answers.length, 0);
    const allow = [...view.container.querySelectorAll('button')].find(b => b.textContent === '本会话允许');
    await act(async () => { allow.click(); allow.click(); });
    assert.equal(answers.length, 1); assert.equal(answers[0].decision, 'allow-session'); assert.equal(answers[0].fingerprint, 'a'.repeat(64)); assert.equal(answers[0].sessionId, 's1');
    assert(!view.container.querySelector('section'));
  } finally { await view.cleanup(); }
});
test('deny and local Escape submit an explicit rejection', async () => {
  for (const via of ['button', 'escape']) {
    const view = await mount();
    try {
      await act(async () => {
        if (via === 'escape') view.container.querySelector('section').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        else [...view.container.querySelectorAll('button')].find(b => b.textContent === '拒绝').click();
      });
      assert.equal(answers.length, 1); assert.equal(answers[0].decision, 'deny');
    } finally { await view.cleanup(); }
  }
});
test('another Session or a malformed request never displays authorization controls', async () => {
  for (const rows of [[request({ sessionId: 'other' })], [request({ fingerprint: 'invalid' })]]) {
    const view = await mount(rows); try { assert(!view.container.querySelector('section')); } finally { await view.cleanup(); }
  }
});
test('hook command text is escaped rather than interpreted as HTML', async () => {
  const view = await mount([request({ hooks: [{ event: 'Stop', command: '<img src=x onerror=alert(1)>', source: '/repo/hooks.json' }] })]);
  try {
    await act(async () => view.container.querySelector('[aria-expanded]').click());
    assert(!view.container.querySelector('img')); assert(view.container.textContent.includes('<img src=x onerror=alert(1)>'));
  } finally { await view.cleanup(); }
});
test('the toolbar icon revokes only the selected Session', async () => {
  const view = await mount([], 's2', 'conversation.input.right');
  try {
    const button = view.container.querySelector('button'); assert.equal(button.getAttribute('aria-label'), '撤销 Hooks 授权');
    await act(async () => button.click()); assert.deepEqual(revoked, ['s2']);
  } finally { await view.cleanup(); }
});
