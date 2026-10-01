import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPermissions, actOnMicrophone } from '../../src/lib/permissionActions.mjs';
function fixture(platform, microphone) {
  const calls = []; const state = { platform, microphone, screen: 'granted' };
  return { calls, state, api: {
    checkPermissions: async () => { calls.push('read'); return state; },
    requestMicPermission: async () => { calls.push('request'); return false; },
    openMicSettings: async () => { calls.push('settings'); return { ok: true }; },
  } };
}
for (const platform of ['darwin', 'win32']) {
  for (const status of ['granted', 'denied', 'restricted', 'not-determined']) test(`${platform} ${status} uses OS status, not the request result`, async () => {
    const f = fixture(platform, status);
    assert.equal((await actOnMicrophone(f.api, platform, status)).microphone, status);
    assert.equal(f.calls.at(-1), 'read');
    assert.equal(f.calls.includes('request'), platform === 'darwin' && status === 'not-determined');
    assert.equal(f.calls.includes('settings'), platform === 'win32' && status !== 'granted' || platform === 'darwin' && status === 'denied');
  });
}
test('query errors and missing bridge are not converted into permission grants or denials', async () => {
  await assert.rejects(readPermissions(undefined), /unavailable/);
  await assert.rejects(readPermissions({ checkPermissions: async () => { throw new Error('query failed'); } }), /query failed/);
  await assert.rejects(readPermissions({ checkPermissions: async () => ({}) }), /Unable to read/);
});
test('request failures, missing APIs and settings failures surface', async () => {
  const f = fixture('darwin', 'not-determined');
  f.api.requestMicPermission = async () => { throw new Error('request failed'); };
  await assert.rejects(actOnMicrophone(f.api, 'darwin', 'not-determined'), /request failed/);
  await assert.rejects(actOnMicrophone({}, 'darwin', 'not-determined'), /unavailable/);
  await assert.rejects(actOnMicrophone({ openMicSettings: async () => ({ ok: false }) }, 'win32', 'denied'), /Unable to open/);
});
