/** Native compaction + real DeepSeek Messages serialization against loopback SSE, no live model/key. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { harnessSource } from './harness-source.mjs';
import * as Hooks from '../dist/index.js';

const { importPackage, packages } = await harnessSource(process.env.DSH_SOURCE_DIR);
const [{ Context }, { mountAgentLoopTestDependencies }, { default: AgentLoop }, { default: TokenMeter }, { default: Basic }, { default: Approval }, llm, session, transport, tools] = await Promise.all([
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-agent-loop-testkit', '@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-token-meter',
  '@deepseek-ai/dsh-compaction-basic', '@deepseek-ai/dsh-user-approval', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-llm-deepseek', '@deepseek-ai/dsh-tools',
].map(importPackage));
const dir = await mkdtemp(join(tmpdir(), 'dsh compact cache '));
const sse = values => values.map(value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`).join('');
function response() {
  return sse([
    { type: 'message_start', message: { id: 'fixed-response', model: 'deepseek-flash', usage: { input_tokens: 100, cache_read_input_tokens: 64, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'preserved reasoning 1017' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'fixed-signature-1017' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'short checkpoint' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }, { type: 'message_stop' },
  ]);
}
async function variant(kind, enabled, control = {}) {
  const requests = [], trace = [], hookInputs = [], warnings = [];
  let overflowSent = false;
  const http = createServer(async (request, reply) => {
    try {
      let body = ''; for await (const chunk of request) body += chunk;
      const value = JSON.parse(body); const summary = JSON.stringify(value.messages).includes('now acting as a compaction engine');
      requests.push({ body: value, raw: body, summary, beta: request.headers['anthropic-beta'], cacheHeaders: {
        user: request.headers['x-deepseek-harness-user-id'], session: request.headers['x-deepseek-harness-session-id'],
        compact: request.headers['x-deepseek-harness-compact'], version: request.headers['anthropic-version'],
      } }); trace.push(summary ? 'llm:summary' : 'llm:turn');
      if (kind === 'overflow' && !summary && JSON.stringify(value.messages).includes('force-overflow') && !overflowSent) {
        overflowSent = true; reply.writeHead(400, { 'content-type': 'application/json' });
        reply.end(JSON.stringify({ error: { message: 'This model maximum context length is 100000 tokens; your input exceeds that limit.', type: 'invalid_request_error', code: 'context_length_exceeded' } })); return;
      }
      reply.writeHead(200, { 'content-type': 'text/event-stream' }); reply.end(response());
    } catch (error) { reply.destroy(error); }
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const ctx = new Context(); ctx.logger.exporter({ levels: { default: 3 }, export(record) { if (record.type === 'warn' || record.type === 'error') warnings.push(record.args.map(String).join(' ')); } });
  let fiber;
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
    await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(TokenMeter); await ctx.plugin(Approval);
    let prompt = 'native stable prompt version one';
    ctx.systemPrompt.section({ name: 'cache-fixture', order: 0, complete: true, text: () => prompt });
    ctx.on('approval/request', () => 'allowed-once');
    ctx.tools.register(tools.defineContentToolFixture({ name: 'cache_probe', description: 'Stable cache regression tool', parameters: { value: { type: 'string' } }, async execute() { throw new Error('Unexpected tool execution'); } }));
    ctx.provide('shell', { resolve: request => request, async execute(request) {
      const payload = JSON.parse(request.stdin); hookInputs.push(payload); trace.push(`hook:${payload.hook_event_name}`);
      if (control.shellThrow) throw new Error('fixture plugin shell failure');
      let output = { hookSpecificOutput: { hookEventName: payload.hook_event_name, additionalContext: 'COMPACT_DIAGNOSTIC_MUST_NOT_ENTER_MODEL' } };
      if ((payload.hook_event_name === 'PreCompact' && control.preStop) || (payload.hook_event_name === 'PostCompact' && control.postStop)) output = { continue: false, stopReason: 'explicit hook stop' };
      if (payload.hook_event_name === 'SessionStart') output = control.restore ? 'restored after compact' : '';
      return { result: async () => ({ exitCode: 0, stdout: { text: typeof output === 'string' ? output : JSON.stringify(output) }, stderr: { text: '' } }) };
    } });
    const adapter = new transport.DeepSeekAdapter({
      options: () => transport.resolveAdapterOptions({ baseURL: `http://127.0.0.1:${http.address().port}/anthropic`, maxTokens: 128, reasoningEffort: 'high',
        models: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', contextWindow: 100_000, systemPromptUpdate: 'in-history', toolUpdate: 'addition-only' }] }),
      resolveAuth: async () => ({ headers: { 'x-api-key': 'loopback-fixture-only' } }), resolveUserId: () => 'cache-fixture-user',
      resolveAttachments: () => undefined, prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
    });
    ctx.llm.registerAdapter(['deepseek-official'], adapter);
    const prepared = await adapter.prepareCall('deepseek-official', 'deepseek-flash');
    assert.equal(prepared.model.systemPromptUpdate, 'in-history'); assert.equal(prepared.model.toolUpdate, 'addition-only');
    const cfg = join(dir, `${kind}-${enabled}-${control.preStop ?? false}-${control.postStop ?? false}.json`);
    await writeFile(cfg, JSON.stringify({ hooks: {
      PreCompact: [{ matcher: 'manual|auto', hooks: [{ type: 'command', command: 'pre' }] }],
      PostCompact: [{ matcher: 'manual|auto', hooks: [{ type: 'command', command: 'post' }] }],
      SessionStart: [{ matcher: '^compact$', hooks: [{ type: 'command', command: 'restore' }] }],
    } }));
    if (control.broken) await writeFile(cfg, 'broken configuration');
    const loadHooks = async () => { fiber = ctx.plugin(Hooks, { discover: false, configPaths: [cfg], pluginDataRoot: join(dir, `${kind}-${enabled}-${!!control.broken}-${!!control.shellThrow}-state`), controlsPath: join(dir, `${kind}-controls.json`), shellFlavor: 'posix' }); await fiber; };
    if (enabled && kind === 'pressure') await loadHooks(); // Also exercise hooks loaded before the backend.
    await ctx.plugin(Basic, { auto: kind === 'overflow', thresholdRatio: kind === 'pressure' ? 0.01 : 0.99, retainTokens: 0, headroomTokens: 0, maxTokens: 256 });
    if (enabled && kind !== 'pressure') await loadHooks();
    ctx.on('session/event', (_session, event) => { if (['compaction/start', 'compaction/summary', 'compaction/end'].includes(event.type)) trace.push(event.type); });
    const agent = await ctx.agentLoop.create(session.SessionId('cache-1017'), { provider: 'deepseek-official', model: 'deepseek-flash', maxTokens: 128 }, { cwd: dir });
    if (control.never) agent.session.append('approval/policy', { policy: 'never' });
    const send = async text => { agent.followup(llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })); await agent.whenIdle(); };
    await send('fixed older history 1017 '.repeat(1500)); prompt = 'native changed prompt version two'; await send('ordinary continuation');
    assert.equal(requests.length, 2, `seeding failed: ${warnings.join('\n')}`);
    assert(JSON.stringify(requests[0].body.tools).includes('cache_probe'), 'the comparison must include real native tool declarations');
    assert.deepEqual(requests[1].body.system, requests[0].body.system, 'in-history update must preserve the leading system prefix');
    assert(JSON.stringify(requests[1].body.messages).includes(prompt), 'the native mid-conversation system update must be retained');
    if (kind === 'manual') {
      if (control.preStop || control.postStop) await assert.rejects(ctx.compaction.compactNow(agent, new AbortController().signal));
      else assert(await ctx.compaction.compactNow(agent, new AbortController().signal));
      if (!control.preStop && !control.postStop) await send('resume after compact');
      if (control.resumeAfterStop) await send('explicit continuation after stop');
    } else {
      if (kind === 'pressure') {
        let needed = true;
        ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
          if (needed) { needed = false; assert(await ctx.compaction.compactIfNeeded(agent, 'pressure', signal)); }
          return next();
        });
      }
      await send(kind === 'overflow' ? 'force-overflow' : 'pressure continuation');
    }
    const summaries = requests.filter(request => request.summary);
    if (control.preStop) assert.equal(summaries.length, 0);
    else assert.equal(summaries.length, 1, `native compaction did not execute once: ${warnings.join('\n')}`);
    if (enabled && !control.never && !control.broken) {
      const expected = kind === 'manual' ? 'manual' : 'auto';
      assert.equal(hookInputs.filter(input => input.hook_event_name === 'PreCompact').length, 1);
      assert.equal(hookInputs.find(input => input.hook_event_name === 'PreCompact').trigger, expected);
      assert.equal(hookInputs.filter(input => input.hook_event_name === 'PostCompact').length, control.preStop ? 0 : 1);
      if (!control.preStop) assert(trace.indexOf('compaction/end') < trace.indexOf('hook:PostCompact'));
      if (!control.preStop && !control.postStop) assert(trace.indexOf('hook:PostCompact') < trace.indexOf('hook:SessionStart'));
      if (kind === 'manual') assert.equal(hookInputs.find(input => input.hook_event_name === 'PreCompact').turn_id, '');
      else assert.equal(hookInputs.find(input => input.hook_event_name === 'PreCompact').turn_id, '3');
    }
    if (control.never) assert.equal(hookInputs.length, 0, 'never policy cannot authorize hook execution');
    assert(!JSON.stringify(requests).includes('COMPACT_DIAGNOSTIC_MUST_NOT_ENTER_MODEL'));
    assert(JSON.stringify(requests[1].body.messages).includes('preserved reasoning 1017'), 'reasoning must pass back unchanged');
    if (control.restore) assert(JSON.stringify(requests.at(-1).body.messages).includes('restored after compact'));
    const compacted = agent.session.snapshotEvents().filter(event => event.type === 'compaction/summary').length;
    if (control.preStop) assert.equal(compacted, 0); if (control.postStop) assert.equal(compacted, 1);
    return { requests, trace, hookInputs };
  } finally {
    await ctx.fiber.dispose(); http.closeAllConnections(); await new Promise(resolve => http.close(resolve));
  }
}
try {
  for (const kind of ['manual', 'pressure', 'overflow']) {
    const baseline = await variant(kind, false), hooked = await variant(kind, true);
    assert.deepEqual(hooked.requests, baseline.requests, `${kind}: hooks changed native DeepSeek request bytes/parameters`);
    console.log(`${kind}: native DeepSeek wire requests identical with/without compact hooks`);
  }
  for (const kind of ['manual', 'pressure', 'overflow']) {
    const baseline = await variant(kind, false, { never: true }), skipped = await variant(kind, true, { never: true });
    assert.deepEqual(skipped.requests, baseline.requests, `${kind}: skipping unapproved hooks must preserve native requests and chat`);
    console.log(`${kind}: full-access/never chat + compaction and wire equality passed without executing unapproved hooks`);
  }
  for (const kind of ['manual', 'pressure', 'overflow']) {
    const baseline = await variant(kind, false);
    for (const control of [{ broken: true }, { shellThrow: true }]) {
      const failed = await variant(kind, true, control);
      assert.deepEqual(failed.requests, baseline.requests, `${kind}: a plugin failure must not escape into native compaction or model requests`);
    }
    console.log(`${kind}: corrupt configuration and throwing hook shell preserve native requests`);
  }
  await variant('manual', true, { preStop: true }); await variant('manual', true, { postStop: true });
  await variant('pressure', true, { preStop: true }); await variant('pressure', true, { postStop: true });
  await variant('overflow', true, { preStop: true }); await variant('overflow', true, { postStop: true });
  await variant('overflow', true, { restore: true });
  await variant('manual', true, { restore: true });
  await variant('manual', true, { postStop: true, restore: true, resumeAfterStop: true });
  console.log(JSON.stringify({ result: 'passed', harness: packages.get('@deepseek-ai/dsh-compaction-basic').manifest.version,
    checks: ['native manual maintenance', 'native pressure policy', 'real context-overflow retry', 'PreCompact/PostCompact timing and stops',
      'SessionStart compact restoration before retry', 'DeepSeek Messages wire equality against unhooked baseline', 'thinking/signature passback',
      'in-history prompt and addition-only tool capability preserved', 'corrupt configuration and shell failures cannot bubble into native compaction', 'no synthetic compaction context in model input', 'both plugin load orders'] }, null, 2));
} finally { await rm(dir, { recursive: true, force: true }); }
