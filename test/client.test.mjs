import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { Modal, Button } from './modal-fixture.mjs';
let plugin, copy, document, dom, createRoot;
const registrations = new Map();
let requests = [], answers = [], revoked = [], forgotten = [];
let listOverride, answerOverride, revokeOverride;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client')); document = dom.window.document;
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(def) { plugin = def.factory(name => name === 'react' ? React : { Modal, Button }); } } }, document, setTimeout, clearTimeout,
  });
  const ctx = {
    effect: fn => fn(), inject: (_deps, fn) => fn(ctx), locale: { register(_ns, dictionaries) { copy = dictionaries; return () => {}; } },
    slots: { inject(_name, fn) { fn(); }, register(spec, component) { registrations.set(spec.name, { spec, component }); return () => {}; } },
    remote: {
      async $mount(contribution) {
        assert.equal(contribution.descriptors.length, 9);
        for (const descriptor of contribution.descriptors) {
          const codec = descriptor.parameters[0].codec.create();
          assert.throws(() => codec.parse({ sessionId: 's1', unexpected: true }));
          if (descriptor.namespace === 'dshHooksPermissions' && descriptor.method !== 'answer') assert.equal(codec.parse({ sessionId: 's1' }).sessionId, 's1');
          if (descriptor.namespace === 'dshHooksPermissions' && descriptor.method === 'answer') {
            assert.equal(codec.parse({ sessionId: 's1', id: 'id', fingerprint: 'a'.repeat(64), decision: 'allow-permanent' }).decision, 'allow-permanent');
            assert.throws(() => codec.parse({ sessionId: 's1', id: 'id', fingerprint: 'a'.repeat(64), decision: 'allow-all' }));
          }
        }
        return () => {};
      },
      dshHooksPermissions: {
        async list({ sessionId }) { return listOverride ? listOverride(sessionId) : { ok: true, value: { requests: requests.filter(r => r.sessionId === sessionId) } }; },
        async answer(request) { answers.push(request); if (answerOverride) return answerOverride(request); requests = []; return { ok: true, value: { accepted: true } }; },
        async revoke({ sessionId }) { revoked.push(sessionId); return revokeOverride ? revokeOverride(sessionId) : { ok: true, value: { revoked: true } }; },
        async status() { return { ok: true, value: { permanent: true, session: true, cwd: '/repo' } }; },
        async forget({ sessionId }) { forgotten.push(sessionId); return { ok: true, value: { revoked: true } }; },
      },
    },
  }; await plugin.apply(ctx);
});
after(() => { dom.window.close(); delete globalThis.window; delete globalThis.document; });
const request = (extra = {}) => ({ id: 'request-1', schema: 'dsh-hooks/approval-v1', sessionId: 's1', cwd: '/repo', fingerprint: 'a'.repeat(64), scope: 'session', hooks: [{ event: 'PreToolUse', command: 'node ./guard.mjs', source: '/repo/.codex/hooks.json' }], ...extra });
const button = name => [...document.querySelectorAll('button')].find(b => b.textContent === name || b.getAttribute('aria-label') === name);
const click = async name => act(async () => button(name).click());
const dialog = () => document.querySelector('[role=dialog]');
async function mount(rows = [request()], sessionId = 's1', slot = 'conversation.input.dock') {
  requests = rows; answers = []; revoked = []; forgotten = [];
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const Component = registrations.get(slot).component;
  const render = async sid => act(async () => root.render(React.createElement('div', null, React.createElement(Component, { sessionId: sid, t: key => copy.zh[key] }), React.createElement('textarea', { 'aria-label': 'native message', defaultValue: 'kept draft' }))));
  await render(sessionId);
  return { container, render, async cleanup() { await act(async () => root.unmount()); container.remove(); listOverride = answerOverride = revokeOverride = undefined; } };
}
test('public slots show one compact trigger without commands or permission actions', async () => {
  assert(registrations.has('conversation.input.dock')); assert(!registrations.has('conversation.input.right')); assert(!registrations.has('conversation.composer'));
  const view = await mount(); try {
    assert.equal(view.container.querySelectorAll('button').length, 1); assert(!dialog()); assert(!view.container.textContent.includes('node ./guard.mjs')); assert(!button('永久允许'));
    assert(view.container.querySelector('section').compareDocumentPosition(view.container.querySelector('textarea')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    await click('Hooks 待授权'); assert(dialog().textContent.includes('/repo/.codex/hooks.json')); assert(dialog().textContent.includes('node ./guard.mjs')); assert.equal(view.container.querySelector('textarea').value, 'kept draft');
  } finally { await view.cleanup(); }
});
test('Escape/close dismisses without denying; reopening retains the request', async () => {
  const view = await mount(); try {
    await click('Hooks 待授权'); await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert(!dialog()); assert.equal(answers.length, 0); await click('Hooks 待授权'); await click('关闭'); assert(!dialog()); assert.equal(answers.length, 0);
    await click('Hooks 待授权'); await click('拒绝'); assert.equal(answers[0].decision, 'deny'); assert(!dialog());
  } finally { await view.cleanup(); }
});
test('session/permanent approval is explicit, version-bound and single-shot; editor Enter never approves', async () => {
  for (const [name, decision] of [['本会话允许', 'allow-session'], ['永久允许', 'allow-permanent']]) {
    const view = await mount(); try {
      await act(async () => view.container.querySelector('textarea').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      assert.equal(answers.length, 0); await click('Hooks 待授权'); const allow = button(name); await act(async () => { allow.click(); allow.click(); });
      assert.equal(answers.length, 1); assert.equal(answers[0].decision, decision); assert.equal(answers[0].fingerprint, 'a'.repeat(64)); assert.equal(answers[0].sessionId, 's1'); assert(!dialog());
    } finally { await view.cleanup(); }
  }
});
test('other-session/malformed requests cannot display controls', async () => {
  for (const rows of [[request({ sessionId: 'other' })], [request({ fingerprint: 'invalid' })]]) {
    const view = await mount(rows); try { assert(!view.container.querySelector('section')); } finally { await view.cleanup(); }
  }
});
test('command markup is escaped and compact hooks are reviewable', async () => {
  const view = await mount([request({ hooks: ['PreCompact', 'PostCompact'].map(event => ({ event, command: '<img src=x onerror=alert(1)>', source: '/repo/hooks.json' })) })]);
  try { await click('Hooks 待授权'); assert(!dialog().querySelector('img')); assert(dialog().textContent.includes('PostCompact')); assert(dialog().textContent.includes('<img src=x onerror=alert(1)>')); await click('本会话允许'); assert.equal(answers[0].decision, 'allow-session'); }
  finally { await view.cleanup(); }
});
test('authorized dock keeps session/permanent revocation available without a toolbar entry', async () => {
  for (const [action, result] of [['撤销本会话', () => revoked], ['撤销永久允许', () => forgotten]]) {
    listOverride = async () => ({ ok: true, value: { requests: [], status: { session: true, permanent: true, hooks: request().hooks } } });
    const view = await mount([], 's2');
    try { assert.equal(view.container.querySelectorAll('button').length, 1); assert(button('管理 Hooks 授权').textContent.includes('Hooks 已允许')); await click('管理 Hooks 授权'); assert(dialog().textContent.includes('已永久允许')); await click(action); assert.deepEqual(result(), ['s2']); assert(!dialog()); }
    finally { await view.cleanup(); }
  }
  const review = request({ manual: true, id: 'manual:opted-out' });
  listOverride = async () => ({ ok: true, value: { requests: [], status: { session: false, permanent: true, review } } });
  const view = await mount([]);
  try { await click('Hooks 已跳过'); assert(button('永久允许')); await click('撤销永久允许'); assert.deepEqual(forgotten, ['s1']); assert.equal(answers.length, 0); assert(!dialog()); }
  finally { await view.cleanup(); }
});
test('switching session removes an open dialog and ignores late responses', async () => {
  const view = await mount(); let finish;
  try {
    await click('Hooks 待授权'); listOverride = () => new Promise(r => finish = r); await view.render('s2'); assert(!dialog()); const previous = finish; await view.render('s3'); const latest = finish;
    await act(async () => previous({ ok: true, value: { requests: [request({ sessionId: 's2' })] } })); assert(!button('Hooks 待授权'));
    await act(async () => latest({ ok: true, value: { requests: [request({ sessionId: 's3' })] } })); await click('Hooks 待授权'); await click('永久允许'); assert.equal(answers[0].sessionId, 's3'); assert.equal(view.container.querySelector('textarea').value, 'kept draft');
  } finally { await view.cleanup(); }
});
test('withdrawn requests cannot resurrect from stale polls', async () => {
  const view = await mount(); try {
    answerOverride = async () => ({ ok: true, value: { accepted: false } }); await click('Hooks 待授权'); await click('本会话允许'); assert(!dialog());
    await act(async () => new Promise(r => setTimeout(r, 550))); assert(!view.container.querySelector('section')); assert.equal(answers.length, 1);
  } finally { await view.cleanup(); }
});
test('permanent save failure stays reviewable and supports explicit retry', async () => {
  const view = await mount(); try {
    await click('Hooks 待授权'); answerOverride = async () => ({ ok: false, error: { message: 'permission storage is read-only' } }); await click('永久允许');
    assert(dialog().querySelector('[role=alert]').textContent.includes('read-only')); assert.equal(button('永久允许').disabled, false); assert.equal(answers.length, 1);
    answerOverride = undefined; await click('永久允许'); assert.equal(answers.length, 2); assert(!dialog());
  } finally { await view.cleanup(); }
});
test('revoke is single-shot and a session change ignores old completion', async () => {
  listOverride = async () => ({ ok: true, value: { requests: [], status: { session: true, hooks: request().hooks } } });
  const view = await mount([], 's1'); let finish;
  try {
    revokeOverride = () => new Promise(r => finish = r); await click('管理 Hooks 授权'); const revoke = button('撤销本会话'); await act(async () => { revoke.click(); revoke.click(); }); assert.deepEqual(revoked, ['s1']);
    await view.render('s2'); assert(!dialog()); await act(async () => finish({ ok: true, value: { revoked: true } })); assert(!dialog());
  } finally { await view.cleanup(); }
});
test('legacy hosts without a manual review token keep the skipped notice read-only', async () => {
  listOverride = async () => ({ ok: true, value: { requests: [], status: { cwd: '/repo', fingerprint: 'a'.repeat(64), hooks: request().hooks, session: false, permanent: false, approvalPolicy: 'never' } } });
  const view = await mount([]); try {
    assert(button('Hooks 已跳过')); await click('Hooks 已跳过'); assert(dialog().textContent.includes('当前模式关闭了审批'));
    assert(dialog().textContent.includes('node ./guard.mjs')); assert(!button('永久允许')); assert(!button('本会话允许')); assert.equal(answers.length, 0);
    await click('关闭'); assert.equal(view.container.querySelector('textarea').value, 'kept draft');
  } finally { await view.cleanup(); }
});
test('skipped hooks with an owner review token expose session/permanent/deny actions without a mode switch', async () => {
  for (const [label, decision] of [['本会话允许', 'allow-session'], ['永久允许', 'allow-permanent'], ['拒绝', 'deny']]) {
    const review = request({ manual: true, id: 'manual:review-1' });
    listOverride = async () => ({ ok: true, value: { requests: [], status: { session: false, approvalPolicy: 'never', review } } });
    const view = await mount([]); try {
      await click('Hooks 已跳过'); assert(button('本会话允许')); assert(button('永久允许')); assert(button('拒绝'));
      assert(dialog().textContent.includes('手动授权从后续事件生效')); await click(label);
      assert.equal(answers.length, 1); assert.equal(answers[0].id, review.id); assert.equal(answers[0].decision, decision); assert(!dialog());
    } finally { await view.cleanup(); }
  }
});
test('invalid configuration has a compact repair notice and no executable approval controls', async () => {
  listOverride = async () => ({ ok: true, value: { requests: [], status: { problem: 'hooks.json: invalid JSON', session: false } } });
  const view = await mount([]); try {
    await click('Hooks 配置错误'); assert(dialog().textContent.includes('消息仍可正常发送')); assert(dialog().querySelector('[role=alert]').textContent.includes('invalid JSON'));
    assert.equal(answers.length, 0); assert(!button('永久允许'));
  } finally { await view.cleanup(); }
});
