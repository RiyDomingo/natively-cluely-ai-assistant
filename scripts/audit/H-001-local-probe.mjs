// Local smoke + packaged-mode E2E exposure probe. Requires build/build:electron.
// Run sequentially: [smoke|development|packaged]
// The fixture uses real app.isPackaged=true, but is not a signed release artifact.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.argv[2] || 'packaged';
if (!['smoke', 'development', 'packaged'].includes(mode)) throw new Error('Use smoke, development or packaged');
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-security-H001-'));
const bootstrap = path.join(root, 'scripts/audit/local-security-bootstrap.cjs');
const executable = require('electron');
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'DISPLAY', 'XDG_RUNTIME_DIR']
  .filter(key => process.env[key]).map(key => [key, process.env[key]]));

async function run(command, args, extra, label) {
  const profile = path.join(evidence, label);
  const output = fs.createWriteStream(path.join(evidence, label + '.log'));
  const child = spawn(command, args, {
    cwd: root, env: { ...env, ...extra, NATIVELY_SECURITY_PROFILE: profile,
      NATIVELY_SECURITY_MAIN: path.join(root, 'dist-electron/electron/main.js') },
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  let result;
  let stop;
  const done = new Promise((resolve, reject) => {
    stop = resolve;
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    if (!output.writableEnded) output.write(chunk);
    text += chunk;
    for (const line of chunk.toString().split('\n')) {
      if (line.startsWith('[SECURITY-')) console.log(label + ' ' + line);
    }
    const match = text.match(/\[SECURITY-RESULT\] (\{[^\n]+\})/);
    if (match) result = JSON.parse(match[1]);
    if (mode === 'smoke' && text.includes('[SECURITY-CLEAN-QUIT]')) stop({ cleanQuit: true });
  });
  const timer = setTimeout(() => stop({ timeout: true }), 120_000);
  let exit;
  try { exit = await done; } finally {
    clearTimeout(timer);
    // Electron has quit normally before the remaining npm/Vite group is stopped.
    if (process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    } else if (child.exitCode === null) child.kill();
    output.end();
  }
  return { label, result, exit, cleanQuit: text.includes('[SECURITY-CLEAN-QUIT]') };
}

const results = [];
if (mode === 'smoke') {
  results.push(await run('npm', ['start'], {
    NODE_OPTIONS: `--require=${bootstrap}`, NATIVELY_SECURITY_PRELOAD: '1',
    NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
  }, 'npm-start'));
} else if (mode === 'development') {
  for (const [label, flag] of [['development-off', '0'], ['development-on', '1']]) {
    results.push(await run(executable, ['.'], {
      NODE_ENV: 'production', NATIVELY_E2E: flag,
      NODE_OPTIONS: `--require=${bootstrap}`, NATIVELY_SECURITY_PRELOAD: '1',
    }, label));
  }
} else {
  if (process.platform !== 'darwin') throw new Error('This fixture currently copies the macOS Electron.app; Windows needs its own packaging fixture');
  const fixture = path.join(evidence, 'NativelySecurityFixture.app');
  fs.cpSync(path.resolve(executable, '../../..'), fixture, { recursive: true, verbatimSymlinks: true });
  const appDir = path.join(fixture, 'Contents/Resources/app');
  fs.mkdirSync(appDir, { recursive: true });
  fs.symlinkSync(path.join(root, 'dist'), path.join(appDir, 'dist'), 'dir');
  // Generated fixture files only; production sources are not rewritten.
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'natively-security-fixture', version: '2.8.8', main: 'main.cjs' }));
  fs.writeFileSync(path.join(appDir, 'main.cjs'), `require(${JSON.stringify(bootstrap)});\nrequire(${JSON.stringify(path.join(root, 'dist-electron/electron/main.js'))});\n`);
  const binary = path.join(fixture, 'Contents/MacOS/NativelySecurityFixture');
  fs.renameSync(path.join(fixture, 'Contents/MacOS/Electron'), binary);
  const plist = path.join(fixture, 'Contents/Info.plist');
  fs.writeFileSync(plist, fs.readFileSync(plist, 'utf8').replace(
    /(<key>CFBundleExecutable<\/key>\s*<string>)Electron(<\/string>)/,
    '$1NativelySecurityFixture$2',
  ));
  for (const [label, flag] of [['packaged-off', '0'], ['packaged-on-1', '1'], ['packaged-on-2', '1']]) {
    results.push(await run(binary, [], { NODE_ENV: 'production', NATIVELY_E2E: flag }, label));
  }
}
fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ mode, results }, null, 2));
console.log('Evidence: ' + evidence);
console.log(JSON.stringify(results, null, 2));
if (results.some(run => !run.result || !run.cleanQuit || !run.result.visible)
  || results.some(run => run.result.packaged !== (mode === 'packaged'))) process.exitCode = 2;
else {
  const { E2E_TEST_CHANNELS } = require(path.join(root, 'dist-electron/electron/services/e2eTestPolicy.js'));
  const expectedChannels = [...E2E_TEST_CHANNELS].sort();
  const failed = results.some(({ label, result }) => {
    const enabled = label === 'development-on';
    return result.bridge !== (enabled ? 'function' : 'undefined')
      || result.syntheticHandlerCaptured !== enabled
      || JSON.stringify(result.registeredTestChannels) !== JSON.stringify(enabled ? expectedChannels : [])
      || !result.policyReplies?.length || result.policyReplies.some(reply => reply !== enabled)
      || (enabled && (!result.e2eReadSucceeded || !result.productionRejected || !result.namedProductionReadSucceeded));
  });
  if (failed) process.exitCode = 1;
}
