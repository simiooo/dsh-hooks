import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installCompactionBridge } from '../dist/compaction.js';

const signal = () => new AbortController().signal;
function fixture(t, options = {}) {
  const events = [], trace = [], native = [], warnings = []; let busy = false, index = 0;
  const input = Object.freeze({ messages: Object.freeze([{ role: 'system', content: 'fixed' }, { role: 'user', content: 'history' }]), tools: Object.freeze([{ name: 'tool' }]) });
  const owner = { session: { snapshotEvents: () => [...events] }, runMaintenance(job) {
    if (busy) throw new Error('busy'); busy = true;
    return Promise.resolve(job(signal())).finally(() => { busy = false; });
  } };
  async function transaction(receiver, owner, sig) {
    if (options.noop) return null;
    const id = `compact-${++index}`; events.push({ type: 'compaction/start', data: { compactionId: id } }); trace.push('start');
    options.onStart?.(owner);
    try {
      await receiver.summarize(input, owner, sig);
      if (options.retry) await receiver.summarize(input, owner, sig);
      sig?.throwIfAborted();
      if (options.fail) throw new Error('summary failed');
      events.push({ type: 'compaction/summary', data: { compactionId: id } }); trace.push('commit');
      events.push({ type: 'compaction/end', data: { compactionId: id } }); trace.push('end');
    } catch (error) { events.push({ type: 'compaction/end', data: { compactionId: id, error: String(error) } }); throw error; }
    if (options.flushFailure) throw new Error('persistence failed');
    return { compactionId: id };
  }
  const ctx = Object.freeze({ marker: 'native context' });
  class Backend {
    ctx = ctx;
    async summarize(value, agent, sig) { assert.equal(this.ctx, ctx); native.push(value); trace.push('summary'); return options.summary ? options.summary(value, agent, sig) : 'short'; }
    async compactRegion(_start, _end, agent, sig) { return transaction(this, agent, sig); }
    compactNow(agent, sig) { return agent.runMaintenance(inner => transaction(this, agent, AbortSignal.any([inner, sig]))); }
    compactIfNeeded(agent, needed, sig) { return needed ? this.compactRegion(1, 2, agent, sig) : Promise.resolve(null); }
  }
  const backend = new Backend();
  const bridge = installCompactionBridge(backend, {
    async before(agent, trigger, sig) { trace.push(`pre:${trigger}`); assert.equal(agent, owner); if (options.before) await options.before(sig); },
    async after(agent, trigger, sig) { trace.push(`post:${trigger}`); assert.equal(agent, owner); if (options.after) await options.after(sig); },
    warn: value => warnings.push(value),
  }); t.after(() => bridge.dispose());
  return { backend, owner, bridge, trace, events, native, input, warnings };
}

test('auto and manual gate actual summarization and await PostCompact inside maintenance', async t => {
  for (const kind of ['auto', 'manual']) {
    let release; const gate = new Promise(r => release = r);
    const f = fixture(t, { after: async () => gate });
    const pending = kind === 'auto' ? f.backend.compactRegion(1, 2, f.owner, signal()) : f.backend.compactNow(f.owner, signal());
    while (!f.trace.includes(`post:${kind}`)) await new Promise(r => setTimeout(r, 1));
    if (kind === 'manual') assert.throws(() => f.owner.runMaintenance(async () => {}), /busy/);
    release(); await pending;
    assert.deepEqual(f.trace, ['start', `pre:${kind}`, 'summary', 'commit', 'end', `post:${kind}`]);
    assert.equal(f.native[0], f.input); assert.equal(Object.hasOwn(f.owner, 'runMaintenance'), true);
  }
});

test('no-op pressure checks and empty manual attempts do not execute compact hooks', async t => {
  const f = fixture(t, { noop: true });
  assert.equal(await f.backend.compactIfNeeded(f.owner, false, signal()), null);
  assert.equal(await f.backend.compactNow(f.owner, signal()), null); assert.deepEqual(f.trace, []);
});

test('PreCompact stop performs no summary or replacement and PostCompact never runs on failure', async t => {
  const f = fixture(t, { before: async () => { throw new Error('policy stopped'); } });
  await assert.rejects(f.backend.compactRegion(1, 2, f.owner, signal()), /policy stopped/);
  assert.deepEqual(f.trace, ['start', 'pre:auto']); assert.equal(f.native.length, 0); assert(f.events.at(-1).data.error);
  const failed = fixture(t, { fail: true }); await assert.rejects(failed.backend.compactNow(failed.owner, signal()), /summary failed/);
  assert.equal(failed.trace.some(item => item.startsWith('post:')), false);
});

test('PostCompact stop preserves a committed summary; flush failure still fires PostCompact once', async t => {
  const f = fixture(t, { after: async () => { throw new Error('post stopped'); } });
  await assert.rejects(f.backend.compactNow(f.owner, signal()), /post stopped/); assert(f.trace.includes('commit'));
  assert.equal(f.trace.filter(item => item === 'post:manual').length, 1);
  const flush = fixture(t, { flushFailure: true });
  await assert.rejects(flush.backend.compactNow(flush.owner, signal()), /persistence failed/); assert.equal(flush.trace.filter(item => item === 'post:manual').length, 1);
});

test('summarizer retries share one PreCompact and pass the same native replay input', async t => {
  const f = fixture(t, { retry: true }); await f.backend.compactRegion(1, 2, f.owner, signal());
  assert.equal(f.trace.filter(item => item === 'pre:auto').length, 1); assert.equal(f.native.length, 2);
  assert(f.native.every(input => input === f.input));
});

test('caller cancellation and bridge disposal cannot commit late summaries; methods restore exactly', async t => {
  let entered, finish;
  const started = new Promise(r => entered = r);
  const f = fixture(t, { summary: async (_value, _owner, sig) => { entered(); return new Promise(r => { finish = r; sig.addEventListener('abort', () => r('late'), { once: true }); }); } });
  const pending = f.backend.compactNow(f.owner, signal()); await started; await f.bridge.dispose();
  await assert.rejects(pending); finish('late'); assert.equal(f.trace.includes('commit'), false);
  for (const method of ['compactNow', 'compactRegion', 'summarize']) assert.equal(Object.hasOwn(f.backend, method), false);
});

test('a later extension retaining the temporary maintenance wrapper remains usable after disposal', async t => {
  const f = fixture(t, { onStart(owner) {
    const previous = owner.runMaintenance;
    owner.runMaintenance = function (job) { return previous.call(this, job); };
  } });
  await f.backend.compactNow(f.owner, signal()); await f.bridge.dispose();
  assert.equal(await f.owner.runMaintenance(async () => 17), 17);
});
