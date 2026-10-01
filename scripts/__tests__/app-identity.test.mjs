import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const identity = require('../../app.identity.json');
const pkg = require('../../package.json');
const publicConfig = require('../../electron-builder.public.cjs');
const root = new URL('../../', import.meta.url);
function load(file, dependencies = {}, platform = process.platform) {
  const { outputFiles } = require('esbuild').buildSync({ entryPoints: [fileURLToPath(new URL(file, root))], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false });
  const module = { exports: {} };
  vm.runInNewContext(outputFiles[0].text, { module, exports: module.exports, process: { ...process, platform }, URL, require: name => dependencies[name] || require(name) });
  return module.exports;
}
for (const platform of ['darwin', 'win32']) {
  for (const isolated of [false, true]) test(`${platform}: separate defaults; explicit profile preserved (${isolated})`, () => {
    let name = pkg.name; const calls = [];
    const pathsApi = platform === 'win32' ? path.win32 : path.posix;
    const appData = platform === 'win32' ? 'C:\\App Data' : '/appdata';
    const profile = isolated ? pathsApi.join(appData, 'verifier temporary profile') : pathsApi.join(appData, name);
    const paths = { appData, userData: profile, sessionData: profile };
    const app = { getName: () => name, getPath: key => paths[key], setName: value => { name = value; },
      setPath: (key, value) => { paths[key] = value; }, setAppUserModelId: value => calls.push(value) };
    const created = [];
    const api = load('electron/appIdentity.ts', { electron: { app }, 'node:path': pathsApi, 'node:fs': { mkdirSync: value => created.push(value) } }, platform);
    api.initializeAppIdentity(app, platform);
    assert.equal(name, 'Zatively');
    assert.equal(paths.userData, isolated ? profile : pathsApi.join(appData, 'Zatively'));
    assert.equal(paths.sessionData, paths.userData);
    assert.notEqual(paths.userData, pathsApi.join(appData, 'natively'));
    assert.equal(created.length > 0, !isolated);
    if (platform === 'win32') assert.equal(calls.at(-1), identity.appId);
  });
}
test('identity is initialized before modules capture profile paths; native gate stays first', () => {
  const source = fs.readFileSync(new URL('electron/main.ts', root), 'utf8');
  assert.ok(source.indexOf("import './nativeArchGate'") < source.indexOf("import './appIdentity'"));
  assert.ok(source.indexOf("import './appIdentity'") < source.indexOf('import { DatabaseManager'));
});
test('package, public and signed inheritance use separate identity and real icon assets', async () => {
  assert.equal(pkg.name, identity.packageName);
  assert.equal(require('../../package-lock.json').name, pkg.name);
  assert.equal(pkg.build.appId, identity.appId);
  assert.equal(publicConfig.appId, identity.appId);
  assert.equal(publicConfig.productName, identity.name);
  assert.equal(publicConfig.extraMetadata.appIdentity.appId, identity.appId);
  assert.notEqual(identity.appId, 'com.natively.assistant');
  for (const file of [identity.icon, identity.macIcon, identity.windowsIcon, 'assets/zatively/iconTemplate.png']) assert.ok(fs.statSync(new URL(file, root)).size > 0);
  const icns = fs.readFileSync(new URL(identity.macIcon, root));
  assert.equal(icns.toString('ascii', 0, 4), 'icns'); assert.equal(icns.readUInt32BE(4), icns.length);
  const ico = fs.readFileSync(new URL(identity.windowsIcon, root));
  assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 6);
  const metadata = await require('sharp')(fileURLToPath(new URL(identity.icon, root))).metadata();
  assert.equal(metadata.width, 512); assert.equal(metadata.height, 512); assert.equal(metadata.hasAlpha, true);
});
test('fork payload identity rejects old products, malformed paths and empty metadata', () => {
  const { isOwnUpdate } = load('src/config/appIdentity.ts');
  for (const url of ['Zatively-2.8.9-arm64.zip', 'https://github.com/RiyDomingo/repo/releases/download/v2.8.9/Zatively-Setup-2.8.9.exe']) assert.equal(isOwnUpdate({ files: [{ url }] }), true);
  for (const url of ['Natively-2.8.9.zip', 'Other-2.8.9.exe', 'Zatively-%2Fother.zip', 'Zatively-..zip', 'Zatively-2.8.9.txt', undefined]) assert.equal(isOwnUpdate({ files: [{ url }] }), false);
  for (const info of [null, {}, { files: [] }, { files: [null] }]) assert.equal(isOwnUpdate(info), false);
});
