import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  inside, archiveEntry, resolveArtifact, recordParser, classifyRun, cleanupSpec, runtimeEnv,
} from '../audit/verify-packaged-e2e.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

async function fixture(t, platform, main = 'dist-electron/electron/main.js', link = false) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-package-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, platform === 'darwin' ? 'Package With Spaces.app' : 'Windows Package With Spaces');
  const resources = platform === 'darwin' ? path.join(root, 'Contents', 'Resources') : path.join(root, 'resources');
  const source = path.join(temp, 'archive-source');
  fs.mkdirSync(resources, { recursive: true });
  fs.mkdirSync(path.join(source, 'dist-electron', 'electron'), { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'natively', version: '2.8.8', main }));
  const entry = path.join(source, 'dist-electron', 'electron', 'main.js');
  fs.writeFileSync(entry, '// tiny test entry\n');
  if (link) {
    fs.renameSync(entry, path.join(source, 'other.js'));
    // Construct link metadata explicitly so this fixture does not require
    // Windows symlink privileges or resolve its target while archiving.
    // ASAR's stream API represents links directly, independent of host OS.
    await asar.createPackageFromStreams(path.join(resources, 'app.asar'), [
      { path: 'package.json', type: 'file', streamGenerator: () => fs.createReadStream(path.join(source, 'package.json')), unpacked: false, stat: fs.statSync(path.join(source, 'package.json')) },
      { path: 'dist-electron', type: 'directory', unpacked: false, stat: fs.statSync(path.join(source, 'dist-electron')) },
      { path: 'dist-electron/electron', type: 'directory', unpacked: false, stat: fs.statSync(path.join(source, 'dist-electron/electron')) },
      { path: 'other.js', type: 'file', streamGenerator: () => fs.createReadStream(path.join(source, 'other.js')), unpacked: false, stat: fs.statSync(path.join(source, 'other.js')) },
      { path: 'dist-electron/electron/main.js', type: 'link', symlink: 'other.js', unpacked: false, stat: fs.statSync(path.join(source, 'other.js')) },
    ]);
  } else await asar.createPackage(source, path.join(resources, 'app.asar'));
  const binary = platform === 'darwin' ? path.join(root, 'Contents', 'MacOS', 'Natively With Spaces') : path.join(root, 'Natively.exe');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, 'test binary, never executed');
  if (platform === 'darwin') fs.writeFileSync(path.join(root, 'Contents', 'Info.plist'),
    '<plist><dict><key>CFBundleExecutable</key><string>Natively With Spaces</string></dict></plist>');
  return { root, resources, binary };
}

for (const platform of ['darwin', 'win32']) {
  test(`resolves an ASAR directory package with spaces (${platform})`, async t => {
    const f = await fixture(t, platform);
    const result = resolveArtifact(f.root, platform);
    assert.equal(result.root, fs.realpathSync(f.root));
    assert.equal(result.executable, fs.realpathSync(f.binary));
    assert.equal(result.version, '2.8.8');
    assert.match(result.entrySha256, /^[a-f0-9]{64}$/);
    assert.ok(inside(result.root, result.main));
    assert.ok(result.main.endsWith(path.join('app.asar', 'dist-electron', 'electron', 'main.js')));
  });
  test(`rejects missing executable/resources (${platform})`, async t => {
    const f = await fixture(t, platform);
    fs.unlinkSync(f.binary);
    assert.throws(() => resolveArtifact(f.root, platform), /ENOENT/);
    fs.unlinkSync(path.join(f.resources, 'app.asar'));
    assert.throws(() => resolveArtifact(f.root, platform), /ENOENT/);
  });
}

test('rejects unsupported platforms and escaped archive entries', () => {
  assert.throws(() => resolveArtifact('.', 'linux'), /Unsupported platform/);
  for (const main of ['', undefined, '/workspace/main.js', 'C:\\repo\\main.js',
    '..\\main.js', 'dist-electron/../../main.js', 'dist-electron/../main.js', 'main.js']) {
    assert.throws(() => archiveEntry(main));
  }
  assert.equal(archiveEntry('.\\dist-electron\\electron\\main.js'), 'dist-electron/electron/main.js');
});

test('rejects ASAR entry links rather than following them', async t => {
  const f = await fixture(t, 'darwin', 'dist-electron/electron/main.js', true);
  assert.throws(() => resolveArtifact(f.root, 'darwin'), /Archive link not allowed/);
});

test('rejects a manifest pointing outside the archive', async t => {
  const f = await fixture(t, 'win32', '../../workspace/dist-electron/electron/main.js');
  assert.throws(() => resolveArtifact(f.root, 'win32'), /escapes/);
});

test('rejects unpacked main entries that could resolve to workspace files', async t => {
  const f = await fixture(t, 'darwin');
  const source = path.join(path.dirname(f.root), 'archive-source');
  await asar.createPackageWithOptions(source, path.join(f.resources, 'app.asar'), { unpack: '**/main.js' });
  assert.throws(() => resolveArtifact(f.root, 'darwin'), /contained in ASAR/);
});

test('rejects an unpacked manifest before reading external contents', async t => {
  const f = await fixture(t, 'darwin');
  const source = path.join(path.dirname(f.root), 'archive-source');
  await asar.createPackageWithOptions(source, path.join(f.resources, 'app.asar'), { unpack: '**/package.json' });
  assert.throws(() => resolveArtifact(f.root, 'darwin'), /Manifest must be contained/);
});

test('path confinement respects boundaries, drives and casing on Windows', () => {
  assert.equal(inside('/artifact', '/artifact/main.js', path.posix), true);
  assert.equal(inside('/artifact', '/artifact-other/main.js', path.posix), false);
  assert.equal(inside('C:\\Artifact', 'c:\\artifact\\main.js', path.win32), true);
  assert.equal(inside('C:\\Artifact', 'D:\\Artifact\\main.js', path.win32), false);
  assert.equal(inside('C:\\Artifact', 'C:\\Workspace\\main.js', path.win32), false);
});

test('parses split UTF-8 marker records and unterminated final lines', () => {
  const records = [];
  const parser = recordParser((...record) => records.push(record));
  const data = Buffer.from('ordinary log\n[SECURITY-HARNESS] {"profile":"Résumé"}\r\n[SECURITY-RESULT] {"bridge":"undefined"}\n[SECURITY-CLEAN-QUIT]');
  for (const byte of data) parser.push(Buffer.from([byte]));
  parser.finish();
  assert.deepEqual(records, [['HARNESS', { profile: 'Résumé' }], ['RESULT', { bridge: 'undefined' }], ['CLEAN-QUIT', true]]);
});

test('malformed marker records cannot become success evidence', () => {
  const records = [];
  const parser = recordParser((...record) => records.push(record));
  parser.push(Buffer.from('[SECURITY-RESULT] not-json\n')); parser.finish();
  assert.equal(records[0][0], 'INVALID');
});

const artifact = { archive: '/package/app.asar', main: '/package/app.asar/dist-electron/electron/main.js', platform: 'darwin', arch: 'arm64' };
const passing = () => ({
  flag: '1', profile: '/temporary/profile', errors: [], screenshot: true, cleanQuit: true,
  exit: { code: 0, signal: null },
  harness: { packaged: true, profile: '/temporary/profile', appPath: artifact.archive,
    entryFilename: artifact.main, e2e: true, platform: 'darwin', arch: 'arm64' },
  result: { packaged: true, appPath: artifact.archive, entryFilename: artifact.main,
    visible: true, renderedCharacters: 317, bridge: 'undefined', registeredTestChannels: [],
    policyReplies: [false, false], syntheticHandlerCaptured: false },
});

test('exit 0 requires complete packaged exclusion evidence', () => assert.equal(classifyRun(passing(), artifact), 0));
test('exit 1 identifies an independently observed control regression', () => {
  for (const change of [
    { bridge: 'function' }, { registeredTestChannels: ['__e2e__:context-os-prompt-audit'] },
    { policyReplies: [true] }, { syntheticHandlerCaptured: true },
  ]) {
    const run = passing(); Object.assign(run.result, change);
    assert.equal(classifyRun(run, artifact), 1);
  }
});
test('exit 2 covers incomplete instrumentation, startup and shutdown', () => {
  for (const change of [
    { harness: undefined }, { result: undefined }, { timedOut: true }, { forcedCleanup: true },
    { screenshot: false }, { cleanQuit: false }, { exit: { code: 1, signal: null } }, { errors: ['unsupported debugger'] },
  ]) assert.equal(classifyRun({ ...passing(), ...change }, artifact), 2);
  for (const change of [
    { packaged: false }, { appPath: '/workspace' }, { entryFilename: '/workspace/main.js' },
    { visible: false }, { renderedCharacters: undefined }, { policyReplies: [] }, { policyReplies: [null] },
  ]) {
    const run = passing(); Object.assign(run.result, change);
    assert.equal(classifyRun(run, artifact), 2);
  }
  const run = passing(); run.harness.profile = '/production/profile';
  assert.equal(classifyRun(run, artifact), 2);
  for (const change of [{ e2e: false }, { platform: 'win32' }, { arch: 'x64' }]) {
    const mismatched = passing(); Object.assign(mismatched.harness, change);
    assert.equal(classifyRun(mismatched, artifact), 2);
  }
});

test('cleanup targets only the owned process group on macOS', () => {
  assert.deepEqual(cleanupSpec('darwin', 123), { group: -123, signal: 'SIGKILL' });
  for (const pid of [undefined, 0, 1, -1, '123']) assert.throws(() => cleanupSpec('darwin', pid));
});
test('Windows cleanup uses taskkill by exact PID and tree, without a shell', () => {
  assert.deepEqual(cleanupSpec('win32', 123, 'C:\\Windows'), {
    command: 'C:\\Windows\\System32\\taskkill.exe', args: ['/PID', '123', '/T', '/F'],
  });
  assert.throws(() => cleanupSpec('win32', 123, 'relative'), /SystemRoot/);
  assert.throws(() => cleanupSpec('linux', 123), /Unsupported/);
});
test('runtime environment excludes credentials, NODE_OPTIONS and unrelated test flags', () => {
  const env = runtimeEnv({ Path: 'path', SystemRoot: 'C:\\Windows', OPENAI_API_KEY: 'not-a-real-key',
    NODE_OPTIONS: '--require=untrusted', NATIVELY_TEST_INIT_FAULT: '1', GH_TOKEN: 'not-a-real-token' }, '/temp', artifact, '1');
  assert.equal(env.Path, 'path'); assert.equal(env.SystemRoot, 'C:\\Windows');
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.NATIVELY_TEST_INIT_FAULT, undefined); assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.NATIVELY_SECURITY_MAIN, artifact.main);
  assert.equal(env.NATIVELY_E2E, '1');
});
