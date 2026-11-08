import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import * as Plugin from '../dist/index.js';
import { harnessSource } from './harness-source.mjs';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const source = process.env.DSH_SOURCE_DIR;
if (!source) throw new Error('Set DSH_SOURCE_DIR to a built deepseek-harness checkout (0.2.1-rc.2 or compatible).');
const { importPackage: hostImport, packages } = await harnessSource(source);
const protocolRequire = createRequire(join(packages.get('@deepseek-ai/dsh-typert-protocol').dir, 'package.json'));
const protocolUrl = pathToFileURL(protocolRequire.resolve('@deepseek-ai/dsh-typert-protocol')).href;
const protocolResolution = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === '@deepseek-ai/dsh-typert-protocol' ? protocolUrl : specifier, context);
} });
const [{ Context }, { mountAgentLoopTestDependencies }, { default: AgentLoop }, { default: Approval }, { default: LocalSubprocess }, { default: LocalShell }, llm, tools, session] = await Promise.all([
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-agent-loop-testkit', '@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-user-approval',
  '@deepseek-ai/dsh-subprocess-local', process.platform === 'win32' ? '@deepseek-ai/dsh-pwsh-local' : '@deepseek-ai/dsh-bash-local', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-session',
].map(hostImport));
class Adapter extends llm.LlmAdapter {
  requests = [];
  constructor(script) { super(); this.script = script; }
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(options) {
    this.requests.push(options);
    const message = this.script.shift(); if (!message) throw new Error('smoke script exhausted');
    const block = typeof message === 'string' ? { type: 'text', text: message } : { type: 'tool-call', id: llm.ToolCallId(`call-${this.requests.length}`), name: message.name, arguments: JSON.stringify(message.args) };
    yield { type: 'block-start', index: 0, blockType: block.type };
    yield { type: 'block-end', index: 0, block };
    yield { type: 'finish', reason: { kind: block.type === 'text' ? 'stop' : 'tool-calls' } };
  }
}
const dir = await mkdtemp(join(tmpdir(), 'dsh hooks real '));
const ctx = new Context();
ctx.logger.exporter({ levels: { default: 3 }, export(message) { if (message.type === 'warn' || message.type === 'error') console.error(...message.args); } });
try {
  const capture = join(dir, 'events.jsonl'), scriptPath = join(dir, 'hook.mjs'), configPath = join(dir, 'hooks.json');
  await writeFile(scriptPath, `import fs from 'node:fs';
let input=''; for await(const chunk of process.stdin) input+=chunk;
const p=JSON.parse(input); fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify(p)+'\\n');
if(p.hook_event_name==='SessionStart') console.log('startup context');
if(p.hook_event_name==='PreToolUse'&&p.tool_input.text==='blocked') {console.error('deny fixture');process.exit(2);}
if(p.hook_event_name==='PostToolUse') console.log(JSON.stringify({continue:false,stopReason:'replacement feedback',hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext:'post context'}}));
if(p.hook_event_name==='Stop') console.log(JSON.stringify(p.stop_hook_active?{}:{decision:'block',reason:'one more pass'}));
`);
  const command = `node "${scriptPath.replaceAll('\\', '/')}"`;
  await writeFile(configPath, JSON.stringify({ hooks: Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'].map(event => [event, [{ hooks: [{ type: 'command', command, timeout: 15 }] }]])) }));
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
  await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(Approval);
  await ctx.plugin(LocalSubprocess); await ctx.plugin(LocalShell, { timeoutMs: 10_000 });
  const [{ default: Registry }, { default: Access }, { default: Gateway }, { Peer }] = await Promise.all([
    '@deepseek-ai/dsh-typert-registry', '@deepseek-ai/dsh-api-remote-access', '@deepseek-ai/dsh-api-gateway', '@deepseek-ai/dsh-client-connection',
  ].map(hostImport));
  await ctx.plugin(Registry); await ctx.plugin(Access); await ctx.plugin(Gateway, {});
  const peer = new Peer(ctx, { principal: { kind: 'owner' }, interactions: 'answer' });
  const invoke = (method, request, caller = peer) => ctx.typertGateway.invoke({ namespace: 'dshHooksPermissions', method, args: { request }, peer: caller });
  const manage = (method, request, caller = peer) => ctx.typertGateway.invoke({ namespace: 'dshHooksManagement', method, args: { request }, peer: caller });
  const asks = [];
  const reviewSession = async (sid, selected = 'allow-session') => {
      let listed;
      const deadline = Date.now() + 3000;
      while (!listed) {
        try { listed = await invoke('list', { sessionId: sid }); }
        catch (error) { if (error.code !== 'gateway/invocation-unavailable' || Date.now() > deadline) throw error; await new Promise(resolve => setTimeout(resolve, 5)); }
      }
      const request = listed.status.review;
      assert(request?.manual, 'Owner review must exist independently of native tool approval');
        asks.push(request);
        assert.equal((await invoke('answer', { sessionId: 'other', id: request.id, fingerprint: request.fingerprint, decision: 'allow-session' })).accepted, false);
        assert.equal((await invoke('answer', { sessionId: request.sessionId, id: request.id, fingerprint: '0'.repeat(64), decision: 'allow-session' })).accepted, false);
        assert.equal((await invoke('answer', { sessionId: request.sessionId, id: request.id, fingerprint: '0'.repeat(64), decision: 'allow-permanent' })).accepted, false);
        const decision = { sessionId: request.sessionId, id: request.id, fingerprint: request.fingerprint, decision: selected };
        assert.equal((await invoke('answer', decision)).accepted, true);
        assert.equal((await invoke('answer', decision)).accepted, false);
  };
  const adapter = new Adapter([{ name: 'echo', args: { text: 'blocked', nested: { count: 7 } } }, { name: 'echo', args: { text: 'allowed' } }, 'first', 'continued', 'after reload', 'continued again']);
  ctx.llm.registerAdapter(['mock'], adapter);
  const executions = [];
  ctx.tools.register(tools.defineContentToolFixture({ name: 'echo', description: 'smoke', parameters: { text: { type: 'string' }, nested: { type: 'object', properties: { count: { type: 'integer' } }, additionalProperties: false } }, async execute(args) { executions.push(args.text); return [{ type: 'text', text: 'ORIGINAL_TOOL_OUTPUT' }]; } }));
  const pluginOptions = { discover: false, configPaths: [configPath], pluginDataRoot: join(dir, 'state'), controlsPath: join(dir, 'controls.json'), pollIntervalMs: 1000 };
  let hooksFiber = ctx.plugin(Plugin, pluginOptions);
  await hooksFiber;
  const agent = await ctx.agentLoop.create(session.SessionId('hooks-smoke'), { provider: 'mock', model: 'mock' }, { cwd: dir });
  await reviewSession('hooks-smoke');
  const send = value => agent.followup(llm.createUserMessage({ content: [{ type: 'text', text: value }], source: { kind: 'user' } }));
  send('test hook gates'); await agent.whenIdle();
  assert.deepEqual(executions, ['allowed'], 'only the allowed call executes'); assert.equal(asks.length, 1);
  let rows = (await readFile(capture, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.find(r => r.hook_event_name === 'PreToolUse').tool_input, { text: 'blocked', nested: { count: 7 } });
  assert.deepEqual(rows.filter(r => r.hook_event_name === 'Stop').map(r => r.stop_hook_active), [false, true]);
  assert.deepEqual(rows.filter(r => r.hook_event_name === 'Stop').map(r => r.last_assistant_message), ['first', 'continued']);
  assert.equal(rows[0].cwd, dir);
  assert(JSON.stringify(adapter.requests[0]).includes('startup context'), 'SessionStart context must reach first model request');
  assert(JSON.stringify(adapter.requests[2]).includes('replacement feedback'), 'PostToolUse continue:false must return feedback and continue the model');
  assert(JSON.stringify(adapter.requests[2]).includes('post context'));
  assert(!JSON.stringify(adapter.requests[2]).includes('ORIGINAL_TOOL_OUTPUT'), 'original output must be replaced');
  await invoke('revoke', { sessionId: 'hooks-smoke' });
  const catalog = await manage('catalog', {});
  const managedHook = catalog.sources.flatMap(source => source.hooks).find(hook => hook.event === 'PostToolUse');
  const disabled = await manage('setEnabled', { scopeId: catalog.scopeId, revision: catalog.revision, id: managedHook.id, enabled: false });
  assert.equal(disabled.sources.flatMap(source => source.hooks).find(hook => hook.id === managedHook.id).enabled, false);
  await assert.rejects(manage('setEnabled', { scopeId: catalog.scopeId, revision: catalog.revision, id: managedHook.id, enabled: true }), /Hooks changed/);
  const enabled = await manage('setEnabled', { scopeId: disabled.scopeId, revision: disabled.revision, id: managedHook.id, enabled: true });
  const config = await manage('readSource', { scopeId: enabled.scopeId, revision: enabled.revision, sourceId: enabled.sources[0].id });
  const saved = await manage('writeSource', { scopeId: enabled.scopeId, revision: enabled.revision, sourceId: enabled.sources[0].id, content: config.content + '\n' });
  assert.notEqual(saved.revision, enabled.revision);
  // Script-only change: next turn asks again, with no plugin or agent restart.
  await writeFile(scriptPath, (await readFile(scriptPath, 'utf8')) + '\n// changed revision\n');
  await reviewSession('hooks-smoke', 'allow-permanent');
  send('test reload'); await agent.whenIdle(); assert.equal(asks.length, 2);
  rows = (await readFile(capture, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.filter(r => r.hook_event_name === 'Stop').map(r => r.stop_hook_active), [false, true, false, true]);
  assert.equal(adapter.requests.length, 6);
  assert.notEqual(asks[0].fingerprint, asks[1].fingerprint);
  const decisions = agent.session.snapshotEvents().filter(e => e.type === 'approval/decided');
  assert.equal(decisions.length, 0, 'Web/desktop hooks never ask the native tool approval service');
  assert.equal((await readdir(join(dir, 'state/permissions/audit'))).length, 2);
  const noInteraction = new Peer(ctx, { principal: { kind: 'owner' }, interactions: 'none' });
  await assert.rejects(invoke('list', { sessionId: 'hooks-smoke' }, noInteraction), /interactive Host owner/);
  await assert.rejects(manage('catalog', {}, noInteraction), /interactive Host owner/);
  const guest = new Peer(ctx, { principal: { kind: 'guest', id: 'guest' }, interactions: 'answer' });
  await assert.rejects(manage('catalog', {}, guest));
  for (const method of ['status', 'forget']) {
    await assert.rejects(invoke(method, { sessionId: 'hooks-smoke' }, noInteraction), /interactive Host owner/);
    await assert.rejects(invoke(method, { sessionId: 'hooks-smoke' }, guest));
  }
  assert.equal((await invoke('status', { sessionId: 'hooks-smoke' })).permanent, true);
  // Cold plugin restart: only the durable record can authorize a new session.
  await hooksFiber.dispose(); hooksFiber = ctx.plugin(Plugin, pluginOptions); await hooksFiber;
  const persistent = await ctx.agentLoop.create(session.SessionId('hooks-persistent'), { provider: 'mock', model: 'mock' }, { cwd: dir });
  adapter.script.push('saved permission', 'saved continuation');
  persistent.followup(llm.createUserMessage({ content: [{ type: 'text', text: 'after restart' }], source: { kind: 'user' } }));
  await persistent.whenIdle(); assert.equal(asks.length, 2, 'saved permission must survive restart without another approval');
  assert.equal((await invoke('status', { sessionId: 'hooks-persistent' })).permanent, true);
  await invoke('forget', { sessionId: 'hooks-persistent' });
  assert.equal((await invoke('status', { sessionId: 'hooks-persistent' })).permanent, false);
  const untrusted = await ctx.agentLoop.create(session.SessionId('hooks-after-revoke'), { provider: 'mock', model: 'mock' }, { cwd: dir });
  await reviewSession('hooks-after-revoke');
  adapter.script.push('after revoke', 'after revoke continuation');
  untrusted.followup(llm.createUserMessage({ content: [{ type: 'text', text: 'review again' }], source: { kind: 'user' } }));
  await untrusted.whenIdle(); assert.equal(asks.length, 3, 'new session must ask again after permanent revocation');
  // Same conversation: a valid temporary grant survives a switch to full access.
  untrusted.session.append('approval/policy', { policy: 'never' }); const beforeSwitch = adapter.requests.length;
  adapter.script.push('temporary permission survives mode switch', 'temporary continuation');
  untrusted.followup(llm.createUserMessage({ content: [{ type: 'text', text: 'same session, now full access' }], source: { kind: 'user' } }));
  await untrusted.whenIdle(); assert.equal(adapter.requests.length, beforeSwitch + 2); assert.equal(asks.length, 3);
  assert.equal((await invoke('status', { sessionId: 'hooks-after-revoke' })).session, true);
  untrusted.session.append('approval/policy', { policy: 'ask' });
  // The full-access preset uses policy=never: rejecting hook approval must not reject chat.
  const never = await ctx.agentLoop.create(session.SessionId('hooks-never'), { provider: 'mock', model: 'mock' }, { cwd: dir });
  never.session.append('approval/policy', { policy: 'never' });
  const beforeNever = adapter.requests.length, hooksBeforeNever = (await readFile(capture, 'utf8')).trim().split('\n').length;
  adapter.script.push('full access chat works');
  never.followup(llm.createUserMessage({ content: [{ type: 'text', text: 'must reach model in full access mode' }], source: { kind: 'user' } }));
  await never.whenIdle(); assert.equal(adapter.requests.length, beforeNever + 1);
  assert(JSON.stringify(adapter.requests.at(-1)).includes('must reach model in full access mode'));
  assert.equal((await readFile(capture, 'utf8')).trim().split('\n').length, hooksBeforeNever, 'unapproved hooks must not run');
  const skipped = await invoke('list', { sessionId: 'hooks-never' }); assert.equal(skipped.requests.length, 0); assert.equal(skipped.status.approvalPolicy, 'never'); assert.equal(skipped.status.session, false);
  const manual = skipped.status.review; assert(manual?.manual);
  const ownerDecision = { sessionId: 'hooks-never', id: manual.id, fingerprint: manual.fingerprint, decision: 'allow-session' };
  await assert.rejects(invoke('answer', ownerDecision, guest)); await assert.rejects(invoke('answer', ownerDecision, noInteraction));
  assert.equal((await invoke('answer', ownerDecision)).accepted, true); assert.equal((await invoke('answer', ownerDecision)).accepted, false);
  assert.equal((await readFile(capture, 'utf8')).trim().split('\n').length, hooksBeforeNever, 'manual approval must not replay skipped hooks');
  const nativeAsks = never.session.snapshotEvents().filter(event => event.type === 'approval/asked').length;
  const beforeManual = adapter.requests.length; adapter.script.push('manual full access', 'manual full access continuation');
  never.followup(llm.createUserMessage({ content: [{ type: 'text', text: 'after explicit owner approval' }], source: { kind: 'user' } }));
  await never.whenIdle(); assert.equal(adapter.requests.length, beforeManual + 2);
  assert.equal(never.session.snapshotEvents().filter(event => event.type === 'approval/asked').length, nativeAsks);
  assert.equal((await invoke('status', { sessionId: 'hooks-never' })).approvalPolicy, 'never');
  await invoke('revoke', { sessionId: 'hooks-never' }); assert.equal((await invoke('answer', ownerDecision)).accepted, false);
  const denyReview = (await invoke('list', { sessionId: 'hooks-never' })).status.review;
  assert.equal((await invoke('answer', { ...ownerDecision, id: denyReview.id, decision: 'deny' })).accepted, true);
  assert.equal((await invoke('status', { sessionId: 'hooks-never' })).session, false);
  const permanentReview = (await invoke('list', { sessionId: 'hooks-never' })).status.review;
  assert.equal((await invoke('answer', { ...ownerDecision, id: permanentReview.id, decision: 'allow-permanent' })).accepted, true);
  assert.equal((await invoke('status', { sessionId: 'hooks-never' })).permanent, true);
  assert.equal((await invoke('status', { sessionId: 'hooks-never' })).approvalPolicy, 'never');
  // Explicitly approve under ask, then reuse the saved decision under never.
  await invoke('revoke', { sessionId: 'hooks-after-revoke' }); await reviewSession('hooks-after-revoke', 'allow-permanent'); adapter.script.push('review permanent again', 'review continuation');
  untrusted.followup(llm.createUserMessage({ content: [{ type: 'text', text: 'save permanent' }], source: { kind: 'user' } }));
  await untrusted.whenIdle(); assert.equal(asks.length, 4);
  const neverTrusted = await ctx.agentLoop.create(session.SessionId('hooks-never-trusted'), { provider: 'mock', model: 'mock' }, { cwd: dir });
  neverTrusted.session.append('approval/policy', { policy: 'never' }); adapter.script.push('saved full access', 'saved full access continuation');
  const beforeTrusted = adapter.requests.length;
  neverTrusted.followup(llm.createUserMessage({ content: [{ type: 'text', text: 'reuse explicit saved permission' }], source: { kind: 'user' } }));
  await neverTrusted.whenIdle(); assert.equal(adapter.requests.length, beforeTrusted + 2); assert.equal(asks.length, 4);
  assert.equal((await invoke('status', { sessionId: 'hooks-never-trusted' })).permanent, true);
  await invoke('forget', { sessionId: 'hooks-never-trusted' });
  const staleDirectoryReview = (await invoke('list', { sessionId: 'hooks-never' })).status.review;
  const anotherDirectory = join(dir, 'another-directory'); await mkdir(anotherDirectory);
  never.session.append('working-directory/change', { cwd: anotherDirectory });
  assert.equal((await invoke('answer', { sessionId: 'hooks-never', id: staleDirectoryReview.id, fingerprint: staleDirectoryReview.fingerprint, decision: 'allow-permanent' })).accepted, false);
  assert.equal((await invoke('status', { sessionId: 'hooks-never' })).cwd, anotherDirectory);
  never.session.append('working-directory/change', { cwd: dir });
  const { SlotCore } = await hostImport('@deepseek-ai/dsh-client-ui-slots');
  const slots = new SlotCore();
  const removeRoot = slots.register({ name: 'root', children: {
    'conversation.input.dock': { kind: 'list', scope: 'session' },
    'conversation.input.right': { kind: 'list', scope: 'session' },
    'plugins.detail.section': { kind: 'list', scope: 'root' },
  } }, () => null);
  let client;
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(definition) { client = definition.factory(() => ({ createElement() {} })); } } }, setTimeout, clearTimeout,
  });
  const clientCtx = {
    effect: init => init(), inject: (_names, fn) => fn(clientCtx), locale: { register: () => () => {} },
    slots: { inject: (_name, fn) => fn(), register: (...args) => slots.register(...args) },
    remote: { $mount: async contribution => ctx.typert.remotes.register(contribution), dshHooksPermissions: {} },
  };
  await client.apply(clientCtx);
  assert.equal(slots.entriesOfSlot('conversation.input.dock').length, 1);
  assert.equal(slots.entriesOfSlot('conversation.input.right').length, 0);
  assert.equal(ctx.typert.remotes.list().filter(d => d.namespace === 'dshHooksPermissions').length, 5);
  assert.equal(slots.entriesOfSlot('plugins.detail.section').length, 1);
  assert.equal(ctx.typert.remotes.list().filter(d => d.namespace === 'dshHooksManagement').length, 4);
  removeRoot();
  await hooksFiber.dispose();
  rows = (await readFile(capture, 'utf8')).trim().split('\n').map(JSON.parse);
  assert(rows.some(row => row.hook_event_name === 'SessionEnd'), 'approved cleanup must run on plugin unload');
  console.log(JSON.stringify({ result: 'passed', harness: packages.get('@deepseek-ai/dsh-agent').manifest.version, checks: ['real Cordis/AgentLoop', 'real shell command + JSON stdin', 'independent Owner audit without native tool approval', 'real Typert Gateway permission API', 'cross-session, wrong-fingerprint and duplicate answer rejection', 'non-interactive peer rejection', 'session revocation', 'durable approval + cold plugin restart + new session without prompt', 'global revocation + fresh session asks again', 'owner-only status/forget and idle manual session/permanent/deny under never', 'full-access never policy sends chat without running unapproved hooks', 'same-session temporary grant survives full-access switch', 'permanent grant reused under never policy', 'full non-shell arguments', 'tool deny', 'first-request context', 'PostToolUse replacement with model continuation', 'Stop continuation state and text', 'script hot reload and renewed permission', 'real management read/write, switches and stale revision rejection', 'management guest and non-interactive peer rejection', 'native permission/detail SlotCore and Remote descriptor registration', 'approved SessionEnd cleanup and plugin disposal'] }, null, 2));
} finally { await ctx.fiber.dispose(); protocolResolution.deregister(); await rm(dir, { recursive: true, force: true }); }
