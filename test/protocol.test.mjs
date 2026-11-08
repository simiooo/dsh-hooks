import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode, matches, merge, EVENTS } from '../dist/protocol.js';
import { parseHooks } from '../dist/config.js';

const json = value => JSON.stringify(value);
const specific = (event, fields) => json({ hookSpecificOutput: { hookEventName: event, ...fields } });

test('Codex matchers: regex substring, aliases, wildcard, and ignored matcher fields', () => {
  for (const matcher of [undefined, '', '*', '^Bash$', 'ash']) assert(matches({ event: 'PreToolUse', matcher }, ['Bash']));
  assert(!matches({ event: 'PreToolUse', matcher: '^bash$' }, ['Bash']));
  assert(matches({ event: 'PreToolUse', matcher: 'Edit|Write' }, ['apply_patch', 'Edit', 'Write']));
  const { hooks } = parseHooks({ hooks: { Stop: [{ matcher: '[', hooks: [{ type: 'command', command: 'x' }] }] } }, 'fixture');
  assert(matches(hooks[0], []));
});

test('Windows command override and SessionEnd sync semantics are preserved', () => {
  const result = parseHooks({ hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'unix', commandWindows: 'windows', async: true, timeout: 2 }] }] } }, 'f', {}, 'win32');
  assert.equal(result.hooks[0].command, 'windows'); assert.equal(result.hooks[0].async, false);
  assert.equal(result.hooks[0].timeout, 2);
});

test('unsupported events and handler types are diagnosed; malformed runnable configs fail', () => {
  const { diagnostics } = parseHooks({ hooks: { PreModelRequest: [], Stop: [{ hooks: [{ type: 'prompt', prompt: 'x' }] }] } }, 'f');
  assert.equal(diagnostics.length, 2);
  for (const timeout of [-1, 0, Infinity, '30']) assert.throws(() => parseHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x', timeout }] }] } }, 'f'));
  assert.throws(() => parseHooks({ hooks: { PreToolUse: [{ matcher: '[', hooks: [] }] } }, 'f'));
});

test('exit two blocks gates, but never a SessionStart or cleanup notification', () => {
  for (const event of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop']) {
    const out = decode(event, 2, '{"decision":"approve"}', 'policy'); assert.equal(out.block, true); assert.equal(out.reason, 'policy');
  }
  for (const event of ['SessionStart', 'SessionEnd', 'Interrupt']) assert.throws(() => decode(event, 2, '', 'oops'));
  assert.throws(() => decode('PreToolUse', 1, '{"decision":"block"}', 'error'));
});

test('only SessionStart and UserPromptSubmit accept plain stdout as context', () => {
  for (const event of ['SessionStart', 'UserPromptSubmit']) assert.deepEqual(decode(event, 0, '你好', '').context, ['你好']);
  for (const event of ['PreToolUse', 'PostToolUse']) assert.deepEqual(decode(event, 0, 'ignore', '').context, []);
  for (const event of ['Stop', 'Interrupt']) assert.throws(() => decode(event, 0, 'plain', ''));
});

test('event-scoped JSON cannot smuggle a decision through another event', () => {
  assert.throws(() => decode('PreToolUse', 0, specific('Stop', { permissionDecision: 'deny' }), ''));
  assert.throws(() => decode('Stop', 0, '{"decision":', ''));
  assert.throws(() => decode('Stop', 0, '[]', ''));
  assert.throws(() => decode('Stop', 0, '{"continue":"false"}', ''));
});

test('PreToolUse applies deny, context, and recognizes the rewrite capability gap', () => {
  assert.equal(decode('PreToolUse', 0, specific('PreToolUse', { permissionDecision: 'deny', permissionDecisionReason: 'no' }), '').reason, 'no');
  assert.deepEqual(decode('PreToolUse', 0, specific('PreToolUse', { additionalContext: 'context' }), '').context, ['context']);
  assert.deepEqual(decode('PreToolUse', 0, specific('PreToolUse', { permissionDecision: 'allow', updatedInput: { path: 'safe' } }), '').updatedInput, { path: 'safe' });
  for (const fields of [{ continue: false }, { decision: 'approve' }, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } }]) assert.throws(() => decode('PreToolUse', 0, json(fields), ''));
});

test('a stop halt wins over another handler requesting continuation', () => {
  const out = merge([decode('Stop', 0, json({ decision: 'block', reason: 'more' }), ''), decode('Stop', 0, json({ continue: false, stopReason: 'done' }), '')]);
  assert.equal(out.halt, true); assert.equal(out.block, true);
  assert.equal(out.reason, 'done');
});

test('every event accepts empty success and rejects malformed shared field types', () => {
  for (const event of EVENTS) {
    assert.deepEqual(decode(event, 0, ' \n', ''), { block: false, halt: false, context: [] });
    for (const output of ['null', 'true', '[]', '{', json({ continue: 'false' }), json({ stopReason: 1 }), json({ suppressOutput: 'yes' }), json({ systemMessage: {} }), json({ hookSpecificOutput: { hookEventName: event, additionalContext: [] } })]) {
      assert.throws(() => decode(event, 0, output, ''), `${event}: ${output}`);
    }
  }
});

test('PostToolUse replaces results without halting; deny feedback outranks replacement across handlers', () => {
  const replace = decode('PostToolUse', 0, json({ continue: false, stopReason: 'replacement' }), '');
  assert.equal(replace.replace, true); assert.equal(replace.halt, false); assert.equal(replace.block, false);
  const deny = decode('PostToolUse', 0, json({ decision: 'block', reason: 'policy' }), '');
  for (const outputs of [[replace, deny], [deny, replace]]) assert.equal(merge(outputs).reason, 'policy');
  for (const output of [{ suppressOutput: false }, { updatedMCPToolOutput: {} }, { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedMCPToolOutput: {} } }]) assert.throws(() => decode('PostToolUse', 0, json(output), ''));
});

test('Interrupt and SessionEnd controls are advisory; Stop cannot inject unofficial additionalContext', () => {
  for (const event of ['Interrupt', 'SessionEnd']) {
    const out = decode(event, 0, json({ continue: false, decision: 'block', reason: 'advisory', hookSpecificOutput: { hookEventName: event, additionalContext: 'ignored' } }), '');
    assert.equal(out.block || out.halt, false); assert.deepEqual(out.context, []);
  }
  assert.deepEqual(decode('Stop', 0, specific('Stop', { additionalContext: 'ignored' }), '').context, []);
});

test('timer overflow, malformed executable settings and input rewrites fail before execution', () => {
  for (const timeout of [2_147_484, NaN, Number.MAX_VALUE]) assert.throws(() => parseHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x', timeout }] }] } }, 'f'));
  for (const fields of [{ permissionDecision: 'allow', updatedInput: null }, { permissionDecision: 'deny', updatedInput: {} }, { permissionDecisionReason: 4 }]) assert.throws(() => decode('PreToolUse', 0, specific('PreToolUse', fields), ''));
});

test('compact events match trigger, ignore stdout/context and only continue:false stops', () => {
  for (const event of ['PreCompact', 'PostCompact']) {
    assert(matches({ event, matcher: '^manual$' }, ['manual'])); assert(!matches({ event, matcher: '^manual$' }, ['auto']));
    assert.deepEqual(decode(event, 0, 'plain diagnostic', '').context, []);
    assert.equal(decode(event, 0, json({ continue: false, stopReason: 'pause' }), '').halt, true);
    const out = decode(event, 0, json({ decision: 'block', hookSpecificOutput: { hookEventName: event, additionalContext: 'ignored' } }), '');
    assert.equal(out.block || out.halt, false); assert.deepEqual(out.context, []); assert.throws(() => decode(event, 2, '', 'not a veto'));
    assert.throws(() => decode(event, 0, specific('Stop', {}), ''));
  }
});
