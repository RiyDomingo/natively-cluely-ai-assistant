import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const { isE2eTestEnabled, createE2eTestBridge, E2E_TEST_CHANNELS, E2E_TEST_POLICY_CHANNEL } =
  require(path.join(root, 'dist-electron/electron/services/e2eTestPolicy.js'));

test('only an explicitly opted-in unpackaged process enables E2E', () => {
  for (const packaged of [true, false]) {
    for (const flag of [undefined, '0', '1', 'true', '']) {
      assert.equal(isE2eTestEnabled(packaged, flag), !packaged && flag === '1');
    }
  }
});

test('bridge requires an exact true decision from main', () => {
  for (const decision of [false, undefined, null, 'true', '1', 1, {}]) {
    assert.equal(createE2eTestBridge(decision, () => assert.fail('must not invoke')).e2eInvoke, undefined);
  }
});

test('bridge accepts only listed test channels and preserves arguments/errors', async () => {
  const calls = [];
  const bridge = createE2eTestBridge(true, async (...args) => { calls.push(args); return 'ok'; });
  // No entitlement-seeding calls: use a harmless read-only audit channel.
  assert.equal(await bridge.e2eInvoke('__e2e__:context-os-prompt-audit', { sample: 1 }), 'ok');
  assert.deepEqual(calls, [['__e2e__:context-os-prompt-audit', { sample: 1 }]]);
  for (const channel of ['get-meeting-active', 'quit-app', 'rag:query-live',
    '__e2e__:unknown', '__e2e__:', '', null, undefined, 1, {}, ['__e2e__:ask']]) {
    await assert.rejects(bridge.e2eInvoke(channel), /E2E channel not allowed/);
  }
  assert.equal(calls.length, 1, 'denied channels must never reach IPC');
  const error = new Error('transport failure');
  const failing = createE2eTestBridge(true, async () => { throw error; });
  await assert.rejects(failing.e2eInvoke('__e2e__:context-os-prompt-audit'), actual => actual === error);
});

test('allowlist exactly matches registered test handlers, without production channels', () => {
  const source = read('electron/ipcHandlers.ts');
  const registered = [...source.matchAll(/safeHandle\(\s*'(__e2e__:[^']+)'/g)].map(m => m[1]);
  assert.deepEqual([...E2E_TEST_CHANNELS].sort(), registered.sort());
  assert.equal(new Set(E2E_TEST_CHANNELS).size, E2E_TEST_CHANNELS.length);
  assert.ok(Object.isFrozen(E2E_TEST_CHANNELS));
  assert.match(source, /isE2eTestEnabled\(app\.isPackaged, process\.env\.NATIVELY_E2E\)/);
  assert.equal([...source.matchAll(/if \(e2eTestEnabled\)/g)].length, 2);
  assert.doesNotMatch(source, /if \(process\.env\.NATIVELY_E2E/);
});

for (const platform of ['darwin', 'win32']) {
  test(`real bundled preload trusts main, not renderer flags (${platform})`, async () => {
    for (const decision of [false, true, undefined, 'true']) {
      let api;
      const calls = [];
      const queries = [];
      const ipcRenderer = {
        sendSync: channel => { queries.push(channel); return decision; },
        invoke: async (...args) => { calls.push(args); return { success: true }; },
        on: () => {}, removeListener: () => {}, send: () => {},
      };
      vm.runInNewContext(read('dist-electron/electron/preload.js'), {
        module: { exports: {} }, exports: {},
        require: name => name === 'electron' ? {
          ipcRenderer, contextBridge: { exposeInMainWorld: (name, value) => {
            if (name === 'electronAPI') api = value;
          } },
        } : require(name),
        process: { platform, env: {
          NATIVELY_E2E: decision === true ? '0' : '1', NODE_ENV: 'production',
        } },
        console,
      });
      assert.deepEqual(queries, [E2E_TEST_POLICY_CHANNEL], 'one synchronous query per preload');
      assert.ok(api);
      assert.equal(typeof api.e2eInvoke, decision === true ? 'function' : 'undefined');
      // Preload's unrelated startup synchronization may invoke production IPC.
      calls.length = 0;
      if (decision === true) {
        await assert.rejects(api.e2eInvoke('get-meeting-active'), /E2E channel not allowed/);
        assert.equal(calls.length, 0);
        await api.e2eInvoke('__e2e__:context-os-prompt-audit');
        assert.equal(calls[0][0], '__e2e__:context-os-prompt-audit');
      }
    }
  });
}

test('all application windows use the common policy-aware preload', () => {
  const helpers = ['WindowHelper', 'SettingsWindowHelper', 'ModelSelectorWindowHelper', 'CropperWindowHelper'];
  for (const helper of helpers) {
    const source = read(`electron/${helper}.ts`);
    assert.match(source, /new BrowserWindow/);
    const preloads = [...source.matchAll(/^\s*preload:\s*([^\n]+)/gm)];
    assert.ok(preloads.length > 0, helper);
    for (const [, preload] of preloads) assert.match(preload, /path\.join\(__dirname, ['"]preload\.js['"]\)/);
  }
  assert.doesNotMatch(read('electron/preload.ts'), /process\.env\.NATIVELY_E2E/);
});
