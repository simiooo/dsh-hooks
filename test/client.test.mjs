import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
let plugin, copy, document, dom, createRoot, Modal, Button;
const registrations = new Map();
let requests = [], answers = [], revoked = [], forgotten = [];
let listOverride, answerOverride, revokeOverride, ruleOverride, rules = [];
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ Modal, Button } = await import('./modal-fixture.mjs'));
  ({ createRoot } = await import('react-dom/client')); document = dom.window.document;
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(def) { plugin = def.factory(name => name === 'react' ? React : { Modal, Button }); } } }, document, setTimeout, clearTimeout,
  });
  const ctx = {
    effect: fn => fn(), inject: (_deps, fn) => fn(ctx), locale: { register(_ns, dictionaries) { copy = dictionaries; return () => {}; } },
    slots: { inject(_name, fn) { fn(); }, register(spec, component) { registrations.set(spec.name, { spec, component }); return () => {}; } },
    remote: {
      async $mount(contribution) {
        assert.equal(contribution.descriptors.length, 12);
        for (const descriptor of contribution.descriptors) {
          const codec = descriptor.parameters[0].codec.create();
          assert.throws(() => codec.parse({ sessionId: 's1', unexpected: true }));
          if (descriptor.namespace === 'dshHooksPermissions' && !['answer', 'setRule'].includes(descriptor.method)) assert.equal(codec.parse({ sessionId: 's1' }).sessionId, 's1');
          if (descriptor.namespace === 'dshHooksPermissions' && descriptor.method === 'answer') {
            assert.equal(codec.parse({ sessionId: 's1', id: 'id', fingerprint: 'a'.repeat(64), decision: 'allow-permanent' }).decision, 'allow-permanent');
            assert.throws(() => codec.parse({ sessionId: 's1', id: 'id', fingerprint: 'a'.repeat(64), decision: 'allow-all' }));
          }
          if (descriptor.method === 'setRule') {
            assert.throws(() => codec.parse({ sessionId: 's1', revision: 'a'.repeat(64), id: 'b'.repeat(64), choice: 'allow', scope: 'global' }));
            assert.equal(codec.parse({ sessionId: 's1', revision: 'a'.repeat(64), id: 'b'.repeat(64), choice: 'inherit' }).choice, 'inherit');
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
        async setRule(request) { rules.push(request); return ruleOverride(request); },
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
  requests = rows; answers = []; revoked = []; forgotten = []; rules = [];
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const Component = registrations.get(slot).component;
  const render = async sid => act(async () => root.render(React.createElement('div', null, React.createElement(Component, { sessionId: sid, t: key => copy.zh[key] }), React.createElement('textarea', { 'aria-label': 'native message', defaultValue: 'kept draft' }))));
  await render(sessionId);
  return { container, render, async cleanup() { await act(async () => root.unmount()); container.remove(); listOverride = answerOverride = revokeOverride = ruleOverride = undefined; } };
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
test('session approval is explicit, version-bound and single-shot; editor Enter never approves', async () => {
  for (const [name, decision] of [['本会话允许', 'allow-session']]) {
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
test('legacy dock can revoke its own instance without offering durable template operations', async () => {
  for (const [action, result] of [['撤销本会话', () => revoked]]) {
    listOverride = async () => ({ ok: true, value: { requests: [], status: { session: true, permanent: true, hooks: request().hooks } } });
    const view = await mount([], 's2');
    try { assert.equal(view.container.querySelectorAll('button').length, 1); assert(button('管理 Hooks 授权').textContent.includes('Hooks 已允许')); await click('管理 Hooks 授权'); assert(!button('撤销永久允许')); await click(action); assert.deepEqual(result(), ['s2']); assert(!dialog()); }
    finally { await view.cleanup(); }
  }
  const review = request({ manual: true, id: 'manual:opted-out' });
  listOverride = async () => ({ ok: true, value: { requests: [], status: { session: false, permanent: true, review } } });
  const view = await mount([]);
  try { await click('Hooks 已跳过'); assert(!button('永久允许')); assert(!button('撤销永久允许')); assert.equal(answers.length + forgotten.length, 0); }
  finally { await view.cleanup(); }
});
test('switching session removes an open dialog and ignores late responses', async () => {
  const view = await mount(); let finish;
  try {
    await click('Hooks 待授权'); listOverride = () => new Promise(r => finish = r); await view.render('s2'); assert(!dialog()); const previous = finish; await view.render('s3'); const latest = finish;
    await act(async () => previous({ ok: true, value: { requests: [request({ sessionId: 's2' })] } })); assert(!button('Hooks 待授权'));
    await act(async () => latest({ ok: true, value: { requests: [request({ sessionId: 's3' })] } })); await click('Hooks 待授权'); await click('本会话允许'); assert.equal(answers[0].sessionId, 's3'); assert.equal(view.container.querySelector('textarea').value, 'kept draft');
  } finally { await view.cleanup(); }
});
test('withdrawn requests cannot resurrect from stale polls', async () => {
  const view = await mount(); try {
    answerOverride = async () => ({ ok: true, value: { accepted: false } }); await click('Hooks 待授权'); await click('本会话允许'); assert(!dialog());
    await act(async () => new Promise(r => setTimeout(r, 550))); assert(!view.container.querySelector('section')); assert.equal(answers.length, 1);
  } finally { await view.cleanup(); }
});
test('session save failure stays reviewable and supports explicit retry', async () => {
  const view = await mount(); try {
    await click('Hooks 待授权'); answerOverride = async () => ({ ok: false, error: { message: 'permission storage is read-only' } }); await click('本会话允许');
    assert(dialog().querySelector('[role=alert]').textContent.includes('read-only')); assert.equal(button('本会话允许').disabled, false); assert.equal(answers.length, 1);
    answerOverride = undefined; await click('本会话允许'); assert.equal(answers.length, 2); assert(!dialog());
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
test('legacy skipped hooks expose only session/deny actions without a mode switch', async () => {
  for (const [label, decision] of [['本会话允许', 'allow-session'], ['拒绝', 'deny']]) {
    const review = request({ manual: true, id: 'manual:review-1' });
    listOverride = async () => ({ ok: true, value: { requests: [], status: { session: false, approvalPolicy: 'never', review } } });
    const view = await mount([]); try {
      await click('Hooks 已跳过'); assert(button('本会话允许')); assert(!button('永久允许')); assert(button('拒绝'));
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

const policySample = () => ({ cwd: '/repo', revision: 'd'.repeat(64), hooks: [{ id: 'b'.repeat(64), version: 'c'.repeat(64), event: 'UserPromptSubmit', command: 'node recall.mjs', source: '/repo/hooks.json', name: 'Recall', enabled: true, choice: 'inherit', global: 'allow', project: 'inherit', effective: 'allow', from: 'global', reviewRequired: false }] });
const select = async (element, value) => act(async () => { element.value = value; element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });

test('hierarchical session panel edits only the selected instance and exposes origin and restore inheritance', async () => {
  let policy = policySample();
  listOverride = async () => ({ ok: true, value: { requests: [], status: { hierarchical: true, policy } } });
  ruleOverride = async request => {
    assert.deepEqual(Object.keys(request).sort(), ['choice', 'id', 'revision', 'sessionId']);
    policy = { ...policy, revision: 'e'.repeat(64), hooks: policy.hooks.map(row => ({ ...row, choice: request.choice, from: request.choice === 'inherit' ? 'global' : 'session', effective: request.choice === 'inherit' ? 'allow' : request.choice })) };
    return { ok: true, value: policy };
  };
  const view = await mount([]); try {
    assert.equal(view.container.querySelectorAll('button').length, 1); assert(!view.container.textContent.includes('node recall.mjs'));
    await click('Hooks 权限'); assert(dialog().textContent.includes('来自全局设置')); assert(!button('永久允许')); assert(!document.querySelector('[aria-label="权限范围"]'));
    await select(document.querySelector('select'), 'deny'); assert.equal(rules[0].sessionId, 's1'); assert(dialog().textContent.includes('本会话')); assert.equal(answers.length + forgotten.length, 0);
    await click('恢复继承'); assert.equal(rules[1].choice, 'inherit'); assert(dialog().textContent.includes('来自全局设置'));
    assert.equal(view.container.querySelector('textarea').value, 'kept draft');
  } finally { await view.cleanup(); }
});

test('instance updates are single-shot, retain failure and discard completion after switching sessions', async () => {
  const policy = policySample(); let finish;
  listOverride = async () => ({ ok: true, value: { requests: [], status: { hierarchical: true, policy } } });
  ruleOverride = () => new Promise(resolve => finish = resolve);
  const view = await mount([]); try {
    await click('Hooks 权限'); const choice = document.querySelector('select');
    await act(async () => { choice.value = 'deny'; choice.dispatchEvent(new dom.window.Event('change', { bubbles: true })); choice.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    assert.equal(rules.length, 1); await act(async () => finish({ ok: false, error: { message: 'Hook permissions changed' } }));
    assert(dialog().querySelector('[role=alert]').textContent.includes('权限已变化')); assert.equal(choice.disabled, false);
    await select(choice, 'deny'); await view.render('s2'); assert(!dialog());
    await act(async () => finish({ ok: true, value: { ...policy, cwd: '/old-session' } })); assert(!dialog()); await click('Hooks 权限'); assert(!dialog().textContent.includes('/old-session'));
  } finally { await view.cleanup(); }
});

test('a hook UI rendering error is contained and leaves the native message editor mounted', async () => {
  listOverride = async () => ({ ok: true, value: { requests: [], status: { hierarchical: true, policy: { hooks: null } } } });
  const original = console.error; console.error = () => {};
  let view;
  try { view = await mount([]); assert(button('重试')); assert.equal(view.container.querySelector('textarea').value, 'kept draft'); }
  finally { console.error = original; await view?.cleanup(); }
});
