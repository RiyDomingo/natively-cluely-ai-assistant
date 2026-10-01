import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { createReadiness } = require('../audit/probe-readiness.cjs');
const result = { packaged: true, visible: true, renderedCharacters: 100, bridge: 'undefined', registeredTestChannels: [], syntheticHandlerCaptured: false, policyReplies: [false] };
test('fast download cannot start before delayed security readiness', async () => {
  const gate = createReadiness(); let download = false;
  const operation = gate.promise.then(() => { download = true; });
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(download, false);
  gate.ready(result); await operation; assert.equal(download, true);
});
for (const message of ['screenshot failed', 'quit before readiness', 'readiness timed out']) test(message, async () => {
  const gate = createReadiness(); gate.fail(new Error(message)); gate.ready(result);
  await assert.rejects(gate.promise, new RegExp(message));
});
test('security failures cannot resolve the readiness gate', async () => {
  const gate = createReadiness(); gate.ready({ ...result, policyReplies: [true] });
  await assert.rejects(gate.promise, /security readiness/);
});
test('malformed readiness evidence rejects instead of hanging', async () => {
  for (const result of [null, {}, { policyReplies: 'false' }]) {
    const gate = createReadiness(); gate.ready(result);
    await assert.rejects(gate.promise, /security readiness/);
  }
});
test('real external bootstrap resolves only after screenshot and rejects capture/early quit/timeout', async () => {
  for (const mode of ['success', 'capture-failure', 'quit', 'timeout']) {
    const app = new EventEmitter(); Object.assign(app, { isPackaged: true, setPath() {}, getPath: () => '/owned', getAppPath: () => '/app', whenReady: () => new Promise(() => {}), quit() { app.emit('will-quit'); } });
    const ipcMain = { handle() {}, removeHandler() {}, on() {} };
    let timerCallback, captured = false, ready = false, failure;
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(new URL('../audit/local-security-bootstrap.cjs', import.meta.url), 'utf8'), {
      module, exports: module.exports, URL, console: { log() {} },
      process: { env: { NATIVELY_SECURITY_PROFILE: '/owned', NATIVELY_SECURITY_ARTIFACT: '1', NATIVELY_SECURITY_MAIN: '/entry' }, platform: 'darwin', arch: 'arm64', versions: {}, on() {} },
      global: {}, globalThis: {}, setTimeout(callback, delay) { if (delay === 45000) timerCallback = callback; else callback(); return 1; }, clearTimeout() {},
      require(name) {
        if (name === 'electron/main') return { app, ipcMain, session: {}, shell: {}, net: { request() {} } };
        if (name === 'node:fs') return { mkdirSync() {}, writeFileSync() { captured = true; } };
        if (name === 'node:module') return { _load() {} };
        if (name === 'node:net') return { Socket: { prototype: { connect() {} } } };
        if (['node:http', 'node:https'].includes(name)) return { request() {}, get() {} };
        return require(name);
      },
    });
    module.exports.installHarness('/entry', { keepAlive: true, onReady() { assert.equal(captured, true); ready = true; }, onFailure(error) { failure = error; } });
    if (mode === 'quit') app.emit('will-quit');
    else if (mode === 'timeout') timerCallback();
    else {
      const contents = new EventEmitter(); Object.assign(contents, { getURL: () => 'file:///app?window=launcher', executeJavaScript: async () => ({ text: 'x'.repeat(100), bridge: 'object', e2e: 'undefined' }), capturePage: async () => { if (mode === 'capture-failure') throw new Error('capture failed'); return { toPNG: () => Buffer.from('image') }; } });
      app.emit('browser-window-created', {}, { webContents: contents, isDestroyed: () => false, isVisible: () => true });
      contents.emit('did-finish-load'); await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(ready, mode === 'success'); assert.equal(Boolean(failure), mode !== 'success');
  }
});
for (const platform of ['darwin', 'win32']) test(`actual upgrade bootstrap waits for evidence before checking/downloading/installing (${platform})`, async () => {
  const app = new EventEmitter(); Object.assign(app, { getAppPath: () => '/artifact', getPath: () => '/profile', getVersion: () => '2.8.8', quit() {} });
  let callbacks; const calls = [];
  const updater = { app: {}, installerPath: '/installer.exe', setFeedURL() {}, spawnLog: async () => true,
    checkForUpdates: async () => { calls.push('check'); return { updateInfo: { version: '2.8.9' } }; }, quitAndInstall: () => calls.push('install') };
  const state = { updateDownloadState: 'downloaded', downloadUpdate: async () => { calls.push('download'); } };
  const module = { exports: {} };
  const mockRequire = name => {
    if (name === './probe-readiness.cjs') return { createReadiness };
    if (name === './local-security-bootstrap.cjs') return { installHarness(_entry, options) { callbacks = options; return { profile: '/profile', appPath: '/artifact' }; } };
    if (name === 'electron/main') return { app, BrowserWindow: { getAllWindows: () => [{ isVisible: () => true }] }, shell: {} };
    if (name === '/updater') return { autoUpdater: updater };
    if (name === 'node:child_process') return { spawn: () => ({ pid: 123 }) };
    return require(name);
  };
  mockRequire.resolve = () => '/updater';
  vm.runInNewContext(fs.readFileSync(new URL('../audit/upgrade-security-bootstrap.cjs', import.meta.url), 'utf8'), {
    module, exports: module.exports, require: mockRequire, console: { log() {} },
    process: { platform, env: { FORK_QA_PORT: '1234', NATIVELY_SECURITY_PROFILE: '/profile', FORK_QA_INSTALL: '/owned', FORK_QA_TARGET_VERSION: '2.8.9' } },
  });
  module.exports.installHarness('/entry', { entryModule: { exports: { AppState: { isRealUpgrade: () => true, getInstance: () => state } } } });
  const contents = new EventEmitter(); contents.getURL = () => 'file:///artifact?window=launcher';
  app.emit('browser-window-created', {}, { webContents: contents });
  const operation = contents.listeners('did-finish-load')[0]();
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls, []);
  callbacks.onReady(result); await operation; assert.deepEqual(calls, ['check', 'download', 'install']);
  if (platform === 'win32') await assert.rejects(updater.spawnLog('/elevate.exe', []), /Unsupported elevated/);
});
