import { join } from 'node:path';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
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
if(p.hook_event_name==='PostToolUse') console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext:'post context'}}));
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
  const asks = [];
  let answering = false;
  const answerTimer = setInterval(async () => {
    if (answering || !ctx.get('dshHooksPermissions')) return;
    answering = true;
    try {
      for (const request of (await invoke('list', { sessionId: 'hooks-smoke' })).requests) {
        asks.push(request);
        assert.equal((await invoke('answer', { sessionId: 'other', id: request.id, fingerprint: request.fingerprint, decision: 'allow-session' })).accepted, false);
        await invoke('answer', { sessionId: request.sessionId, id: request.id, fingerprint: request.fingerprint, decision: 'allow-session' });
      }
    } finally { answering = false; }
  }, 25);
  ctx.effect(() => () => clearInterval(answerTimer));
  const adapter = new Adapter([{ name: 'echo', args: { text: 'blocked', nested: { count: 7 } } }, 'first', 'continued', 'after reload', 'continued again']);
  ctx.llm.registerAdapter(['mock'], adapter);
  let executions = 0;
  ctx.tools.register(tools.defineContentToolFixture({ name: 'echo', description: 'smoke', parameters: { text: { type: 'string' }, nested: { type: 'object', properties: { count: { type: 'integer' } }, additionalProperties: false } }, async execute() { executions++; return [{ type: 'text', text: 'unexpected' }]; } }));
  await ctx.plugin(Plugin, { discover: false, configPaths: [configPath], pollIntervalMs: 1000 });
  const agent = await ctx.agentLoop.create(session.SessionId('hooks-smoke'), { provider: 'mock', model: 'mock' }, { cwd: dir });
  const send = value => agent.followup(llm.createUserMessage({ content: [{ type: 'text', text: value }], source: { kind: 'user' } }));
  send('test hook gates'); await agent.whenIdle();
  assert.equal(executions, 0, 'denied tool must not execute'); assert.equal(asks.length, 1);
  let rows = (await readFile(capture, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.find(r => r.hook_event_name === 'PreToolUse').tool_input, { text: 'blocked', nested: { count: 7 } });
  assert.deepEqual(rows.filter(r => r.hook_event_name === 'Stop').map(r => r.stop_hook_active), [false, true]);
  assert.deepEqual(rows.filter(r => r.hook_event_name === 'Stop').map(r => r.last_assistant_message), ['first', 'continued']);
  assert.equal(rows[0].cwd, dir);
  assert(JSON.stringify(adapter.requests[0]).includes('startup context'), 'SessionStart context must reach first model request');
  // Script-only change: next turn asks again, with no plugin or agent restart.
  await writeFile(scriptPath, (await readFile(scriptPath, 'utf8')) + '\n// changed revision\n');
  send('test reload'); await agent.whenIdle(); assert.equal(asks.length, 2);
  rows = (await readFile(capture, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.filter(r => r.hook_event_name === 'Stop').map(r => r.stop_hook_active), [false, true, false, true]);
  assert.equal(adapter.requests.length, 5);
  assert.notEqual(asks[0].fingerprint, asks[1].fingerprint);
  const decisions = agent.session.snapshotEvents().filter(e => e.type === 'approval/decided');
  assert.equal(decisions.length, 2); assert(decisions.every(e => e.data.outcome === 'allowed-once'));
  const noInteraction = new Peer(ctx, { principal: { kind: 'owner' }, interactions: 'none' });
  await assert.rejects(invoke('list', { sessionId: 'hooks-smoke' }, noInteraction), /interactive Host owner/);
  await invoke('revoke', { sessionId: 'hooks-smoke' });
  const { SlotCore } = await hostImport('@deepseek-ai/dsh-client-ui-slots');
  const slots = new SlotCore();
  const removeRoot = slots.register({ name: 'root', children: {
    'conversation.input.dock': { kind: 'list', scope: 'session' },
    'conversation.input.right': { kind: 'list', scope: 'session' },
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
  assert.equal(ctx.typert.remotes.list().filter(d => d.namespace === 'dshHooksPermissions').length, 3);
  removeRoot();
  console.log(JSON.stringify({ result: 'passed', harness: packages.get('@deepseek-ai/dsh-agent').manifest.version, checks: ['real Cordis/AgentLoop', 'real shell command + JSON stdin', 'native approval audit', 'real Typert Gateway permission API', 'cross-session answer rejection', 'non-interactive peer rejection', 'session revocation', 'full non-shell arguments', 'tool deny', 'first-request context', 'Stop continuation state and text', 'script hot reload and renewed permission'] }, null, 2));
} finally { await ctx.fiber.dispose(); protocolResolution.deregister(); await rm(dir, { recursive: true, force: true }); }
