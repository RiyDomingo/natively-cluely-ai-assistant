import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createSupervisor, cleanupCommand, waitForServer } from '../dev-app.mjs';
const require = createRequire(import.meta.url);

function fixture() {
  const children = []; let serverStops = 0, electronStops = 0;
  const supervisor = createSupervisor({ startElectron() { const child = new EventEmitter(); children.push(child); return child; },
    stopServer: async () => { serverStops++; }, stopElectron: async () => { electronStops++; }, onError() {} });
  supervisor.launch();
  return { supervisor, children, counts: () => ({ serverStops, electronStops }) };
}
test('restart waits for clean Electron close and retains Vite, even for repeated requests', async () => {
  const f = fixture();
  f.children[0].emit('message', { type: 'unrelated' });
  f.children[0].emit('message', { type: 'natively-dev-restart' });
  f.children[0].emit('message', { type: 'natively-dev-restart' });
  assert.equal(f.children.length, 1); assert.equal(f.counts().serverStops, 0);
  f.children[0].emit('close', 0, null);
  assert.equal(f.children.length, 2); assert.equal(f.counts().serverStops, 0);
  f.children[1].emit('close', 0, null);
  assert.equal(await f.supervisor.finished, 0); assert.equal(f.counts().serverStops, 1);
});
test('restart request does not conceal a crash; explicit shutdown does not relaunch', async () => {
  const f = fixture(); f.children[0].emit('message', { type: 'natively-dev-restart' }); f.children[0].emit('close', 1, null);
  assert.equal(await f.supervisor.finished, 1); assert.equal(f.children.length, 1);
  const g = fixture(); await g.supervisor.stop(); g.children[0].emit('close', 0, null);
  assert.equal(g.children.length, 1); assert.equal(g.counts().serverStops, 1);
});
test('spawn/server failures shut down ownership and no external Vite is accepted', async () => {
  const f = fixture(); f.children[0].emit('error', new Error('spawn failed'));
  assert.equal(await f.supervisor.finished, 1);
  const server = new EventEmitter(); server.stdout = new EventEmitter();
  const ready = waitForServer(server, 20);
  // Even if port 5180 already responds, this child has not announced readiness.
  await assert.rejects(ready, /timed out/);
  const failed = waitForServer(server); server.emit('close', 1);
  await assert.rejects(failed, /stopped before startup/);
});
test('platform-specific forced cleanup targets exactly an owned PID', () => {
  assert.deepEqual(cleanupCommand('win32', 123), ['taskkill.exe', ['/PID', '123', '/T', '/F']]);
  assert.equal(cleanupCommand('darwin', 123), null);
  assert.throws(() => cleanupCommand('win32', -1)); assert.throws(() => cleanupCommand('other', 123));
});
const { outputFiles } = require('esbuild').buildSync({ entryPoints: ['electron/services/devRestart.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
vm.runInNewContext(outputFiles[0].text, { module, exports: module.exports, process: { versions: {}, on() {} } });
const { restartApplication } = module.exports;
test('packaged restart uses relaunch; managed dev signals only its parent; unmanaged rejects', async () => {
  const calls = []; const app = { isPackaged: true, relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit') };
  await restartApplication(app, {}); assert.deepEqual(calls, ['relaunch', 'quit']); calls.length = 0; app.isPackaged = false;
  await assert.rejects(restartApplication(app, { env: {}, connected: false }), /npm start/);
  assert.equal(calls.length, 0);
  await restartApplication(app, { env: { NATIVELY_DEV_SUPERVISOR: '1' }, connected: true, send: (message, callback) => { calls.push(message.type); callback(null); } });
  assert.deepEqual(calls, ['natively-dev-restart', 'quit']);
});
