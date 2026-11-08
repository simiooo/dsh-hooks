import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode, matches, merge } from '../dist/protocol.js';
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
  const { diagnostics } = parseHooks({ hooks: { PreCompact: [], Stop: [{ hooks: [{ type: 'prompt', prompt: 'x' }] }] } }, 'f');
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
});
