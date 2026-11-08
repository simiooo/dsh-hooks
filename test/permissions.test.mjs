import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPermissionRequest } from '../dist/permissions.js';

test('native permission interceptor only accepts its complete typed protocol', () => {
  const valid = { schema: 'dsh-hooks/approval-v1', scope: 'session', sessionId: 's', cwd: '/repo', fingerprint: 'a'.repeat(64), hooks: [{ event: 'Stop', command: 'node hook.mjs', source: 'hooks.json' }] };
  assert(isPermissionRequest(valid));
  for (const value of [null, [], 'request', {}, { ...valid, scope: 'global' }, { ...valid, fingerprint: ['a'.repeat(64)] }, { ...valid, hooks: [null] }, { ...valid, hooks: [{ event: 'Unknown', command: 'x', source: 'x' }] }, { ...valid, hooks: [{ event: 'Stop', command: ' ', source: 'x' }] }]) assert.equal(isPermissionRequest(value), false);
});
