// Test an unchanged electron-builder directory package. Never imported by app code.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bootstrap = path.join(repo, 'scripts/audit/local-security-bootstrap.cjs');

export function inside(root, candidate, paths = path) {
  const relative = paths.relative(root, candidate);
  return relative === '' || (!paths.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${paths.sep}`));
}

export function archiveEntry(main) {
  if (typeof main !== 'string' || !main || /^[A-Za-z]:|^[/\\]/.test(main)) {
    throw new Error('Packaged main must be a relative file');
  }
  const parts = main.replaceAll('\\', '/').split('/');
  if (parts.includes('..')) throw new Error('Packaged main escapes its archive');
  const entry = path.posix.normalize(parts.join('/'));
  if (!entry.startsWith('dist-electron/') || !entry.endsWith('.js')) {
    throw new Error('Expected a built dist-electron JavaScript entry');
  }
  return entry;
}

export function resolveArtifact(app, platform = process.platform) {
  if (!['darwin', 'win32'].includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
  const root = fs.realpathSync(app);
  if (platform === 'darwin' && !root.endsWith('.app')) throw new Error('Expected a macOS .app root');
  const resources = platform === 'darwin' ? path.join(root, 'Contents', 'Resources') : path.join(root, 'resources');
  const archive = path.join(resources, 'app.asar');
  if (!inside(root, fs.realpathSync(archive))) throw new Error('Archive escapes package into external files');
  const asar = require('@electron/asar'); // Existing electron-builder dependency.
  const manifestStat = asar.statFile(archive, 'package.json', false);
  if (manifestStat.link !== undefined || manifestStat.unpacked) {
    throw new Error('Manifest must be contained in ASAR, without links');
  }
  const manifest = JSON.parse(asar.extractFile(archive, 'package.json', false).toString('utf8'));
  const relativeEntry = archiveEntry(manifest.main);
  // ASAR links, including ancestor links, must not redirect into the workspace.
  for (const rel of ['package.json', ...relativeEntry.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'))]) {
    const stat = asar.statFile(archive, rel, false);
    if (stat.link !== undefined) throw new Error(`Archive link not allowed: ${rel}`);
    if (stat.unpacked) throw new Error(`Manifest/entry must be contained in ASAR: ${rel}`);
  }
  const mainBytes = asar.extractFile(archive, relativeEntry, false);
  if (!mainBytes.length) throw new Error('Packaged entry is empty');
  let executable;
  if (platform === 'darwin') {
    const plist = fs.readFileSync(path.join(root, 'Contents', 'Info.plist'), 'utf8');
    const name = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    if (!name || /[/\\]|^\.{1,2}$/.test(name)) throw new Error('Invalid CFBundleExecutable');
    executable = path.join(root, 'Contents', 'MacOS', name);
  } else {
    const name = manifest.productName || manifest.build?.productName || 'Natively';
    if (typeof name !== 'string' || /[/\\]|^\.{1,2}$/.test(name)) throw new Error('Invalid executable name');
    executable = path.join(root, `${name}.exe`);
  }
  if (!inside(root, fs.realpathSync(executable))) throw new Error('Executable escapes package');
  if (!fs.statSync(executable).isFile()) throw new Error('Executable is not a file');
  return { root, resources, archive, executable, platform, arch: process.arch,
    main: path.join(archive, ...relativeEntry.split('/')),
    name: manifest.name, version: manifest.version,
    entrySha256: crypto.createHash('sha256').update(mainBytes).digest('hex') };
}

export function recordParser(onRecord, onLine = () => {}) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const line = text => {
    onLine(text);
    const match = text.match(/^\[SECURITY-([A-Z-]+)\](?: (.*))?$/);
    if (!match) return;
    try { onRecord(match[1], match[2] ? JSON.parse(match[2]) : true); }
    catch { onRecord('INVALID', { marker: match[1] }); }
  };
  return {
    push(chunk) {
      pending += decoder.write(chunk);
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        line(pending.slice(0, end).replace(/\r$/, '')); pending = pending.slice(end + 1);
      }
      if (pending.length > 1024 * 1024) { pending = ''; onRecord('INVALID', { reason: 'oversized line' }); }
    },
    finish() { pending += decoder.end(); if (pending) line(pending); pending = ''; },
  };
}

export function classifyRun(run, artifact) {
  const { harness, result, exit, profile } = run;
  if (!harness || !result || !exit || !Array.isArray(run.errors) || run.errors.length || run.timedOut || run.forcedCleanup
    || !run.cleanQuit || exit.code !== 0 || exit.signal
    || harness.packaged !== true || result.packaged !== true
    || harness.profile !== profile || harness.appPath !== artifact.archive
    || harness.e2e !== (run.flag === '1') || !['0', '1'].includes(run.flag)
    || harness.platform !== artifact.platform || harness.arch !== artifact.arch
    || harness.entryFilename !== artifact.main || result.entryFilename !== artifact.main
    || result.appPath !== artifact.archive || result.visible !== true
    || !Number.isSafeInteger(result.renderedCharacters) || result.renderedCharacters < 50
    || !Array.isArray(result.registeredTestChannels) || !Array.isArray(result.policyReplies)
    || result.registeredTestChannels.some(channel => typeof channel !== 'string')
    || !result.policyReplies.length || result.policyReplies.some(reply => typeof reply !== 'boolean')
    || typeof result.syntheticHandlerCaptured !== 'boolean'
    || !['undefined', 'function'].includes(result.bridge) || run.screenshot !== true) return 2;
  return result.bridge !== 'undefined' || result.registeredTestChannels.length !== 0
    || result.syntheticHandlerCaptured || result.policyReplies.some(reply => reply !== false) ? 1 : 0;
}

export function cleanupSpec(platform, pid, systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid owned process PID');
  if (platform === 'darwin') return { group: -pid, signal: 'SIGKILL' };
  if (platform === 'win32') {
    if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new Error('Windows SystemRoot required for cleanup');
    return { command: path.win32.join(systemRoot, 'System32', 'taskkill.exe'), args: ['/PID', String(pid), '/T', '/F'] };
  }
  throw new Error(`Unsupported cleanup platform: ${platform}`);
}

export function runtimeEnv(source, profile, artifact, flag) {
  const allowed = new Set(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME', 'LANG',
    'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']);
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toUpperCase())));
  return { ...env, NODE_ENV: 'production', NATIVELY_E2E: flag,
    NATIVELY_SECURITY_PROFILE: profile, NATIVELY_SECURITY_MAIN: artifact.main,
    NATIVELY_SECURITY_DEBUGGER: '1', NATIVELY_SECURITY_ARTIFACT: '1' };
}

async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// A small loopback CDP client uses Node's built-in WebSocket, no new dependency.
export async function inspector(url) {
  if (!/^ws:\/\/127\.0\.0\.1:\d+\/[\w-]+$/.test(url)) throw new Error('Non-loopback inspector endpoint');
  const socket = new WebSocket(url);
  const pending = new Map();
  const scripts = new Map();
  let nextId = 0, pauseResolve;
  const paused = new Promise(resolve => { pauseResolve = resolve; });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Debugger.scriptParsed') scripts.set(message.params.scriptId, message.params.url);
    if (message.method === 'Debugger.paused') pauseResolve(message.params);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id); clearTimeout(timer); pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    }
  });
  socket.addEventListener('close', () => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('Inspector disconnected')); }
    pending.clear();
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Inspector connection failed')), { once: true });
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Inspector timeout: ${method}`)); }, 10_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, paused, scripts, close: () => socket.close() };
}

export async function installBeforeEntry(endpoint, artifact, bootstrapFile = bootstrap) {
  const client = await inspector(endpoint);
  try {
    await client.send('Debugger.enable');
    await client.send('Runtime.runIfWaitingForDebugger');
    const pause = await client.paused;
    const frame = pause.callFrames[0];
    const script = client.scripts.get(frame.location.scriptId);
    // Only resume at the packaged entry or Electron's own browser bootstrap.
    // Unknown pauses are inconclusive, never a reason to run unisolated code.
    const atEntry = script?.startsWith('file:') && fileURLToPath(script) === artifact.main;
    if (!atEntry && script !== 'node:electron/js2c/browser_init') {
      throw new Error(`Unsupported initial debugger pause: ${script}`);
    }
    const expression = `process.getBuiltinModule('module').createRequire(${JSON.stringify(bootstrapFile)})`
      + `(${JSON.stringify(bootstrapFile)}).${atEntry ? 'installHarness(undefined, { entryModule: module })' : 'armEntryHook()'}`;
    const evaluation = await client.send('Debugger.evaluateOnCallFrame', {
      callFrameId: frame.callFrameId, expression, returnByValue: true,
    });
    if (evaluation.exceptionDetails) throw new Error('Bootstrap installation threw before entry');
    const confirmation = evaluation.result?.value;
    if (atEntry ? confirmation?.entryFilename !== artifact.main : confirmation?.armed !== true) {
      throw new Error('Bootstrap did not confirm entry interception');
    }
    await client.send('Debugger.resume');
  } finally { client.close(); }
}

export async function runLaunch(artifact, flag, label, evidence, ownedProfile) {
  const profile = ownedProfile ?? fs.mkdtempSync(path.join(evidence, `${label}-`));
  if (!inside(fs.realpathSync(evidence), fs.realpathSync(profile))) throw new Error('Profile must belong to evidence directory');
  const work = path.join(profile, 'work'); fs.mkdirSync(work, { recursive: true });
  const log = fs.createWriteStream(path.join(profile, 'application.log'));
  const run = { label, flag, profile, errors: [] };
  // inspect-brk prevents application entry execution until isolation is installed.
  const child = spawn(artifact.executable, ['--inspect-brk=127.0.0.1:0', `--user-data-dir=${profile}`], {
    cwd: work, env: runtimeEnv(process.env, profile, artifact, flag),
    detached: process.platform === 'darwin', stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let endpointResolve, closedResolve, completed = false;
  const endpoint = new Promise(resolve => { endpointResolve = resolve; });
  const closed = new Promise(resolve => { closedResolve = resolve; });
  child.on('error', error => { run.errors.push(error.message); closedResolve(); });
  child.on('close', (code, signal) => { run.exit = { code, signal }; closedResolve(); });
  for (const stream of [child.stdout, child.stderr]) {
    const parser = recordParser((kind, value) => {
      if (kind === 'HARNESS') run.harness = value;
      else if (kind === 'RESULT') run.result = value;
      else if (kind === 'CLEAN-QUIT') run.cleanQuit = true;
      else if (['INVALID', 'TIMEOUT', 'PROBE-ERROR'].includes(kind)) run.errors.push({ kind, value });
    }, line => {
      const match = line.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/);
      if (match) endpointResolve(match[1]);
      if (line.startsWith('[SECURITY-')) console.log(`${label} ${line}`);
    });
    stream.on('data', chunk => { if (!log.writableEnded) log.write(chunk); parser.push(chunk); });
    stream.on('end', () => parser.finish());
  }
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => { run.timedOut = true; resolve(); }, 90_000); });
  try {
    await Promise.race([
      (async () => { const url = await endpoint; await installBeforeEntry(url, artifact); await closed; completed = true; })(),
      closed, deadline,
    ]);
  } catch (error) { run.errors.push(error.message); }
  finally {
    clearTimeout(timer);
    if (!completed && child.exitCode === null && child.signalCode === null && child.pid) {
      // Normal quit first if the bootstrap initialized the owned IPC channel.
      if (run.harness && child.connected) child.send({ type: 'natively-security-quit' }, () => {});
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5_000))]);
      if (child.exitCode === null && child.signalCode === null) {
        run.forcedCleanup = true;
        const spec = cleanupSpec(process.platform, child.pid);
        if (spec.command) {
          await new Promise(resolve => {
            const killer = spawn(spec.command, spec.args, { stdio: 'ignore' });
            const timeout = setTimeout(() => { run.errors.push('taskkill timed out'); killer.kill(); resolve(); }, 10_000);
            killer.on('error', error => { clearTimeout(timeout); run.errors.push(error.message); resolve(); });
            killer.on('close', code => { clearTimeout(timeout); if (code !== 0) run.errors.push(`taskkill exit ${code}`); resolve(); });
          });
        } else {
          try { process.kill(spec.group, spec.signal); }
          catch (error) { if (error.code !== 'ESRCH') run.errors.push(error.message); }
        }
        await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5_000))]);
        if (!run.exit) {
          run.errors.push('Owned process did not close after cleanup');
          if (child.connected) child.disconnect();
          child.stdout.destroy(); child.stderr.destroy(); child.unref();
        }
      }
    }
    await new Promise(resolve => log.end(resolve));
  }
  run.screenshot = fs.existsSync(path.join(profile, 'launcher.png'));
  run.status = classifyRun(run, artifact);
  return run;
}

export async function verifyPackaged(app, output) {
  const artifact = resolveArtifact(app);
  const evidence = path.resolve(output || fs.mkdtempSync(path.join(os.tmpdir(), 'natively-packaged-e2e-evidence-')));
  if (inside(artifact.root, evidence)) throw new Error('Evidence must be outside the package');
  fs.mkdirSync(evidence, { recursive: true });
  if (fs.existsSync(path.join(evidence, 'results.json'))) throw new Error('Evidence results already exist; choose a fresh output');
  const report = { artifact, platform: process.platform, arch: process.arch, runs: [], errors: [], status: 2 };
  try {
    const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
    const wire = await getCurrentFuseWire(artifact.executable);
    // Fuse wire states are ASCII: '1' means enabled. FuseState is not exported
    // by this installed version's public entrypoint.
    if (wire[FuseV1Options.EnableNodeCliInspectArguments] !== '1'.charCodeAt(0)) {
      throw new Error('Startup inspector disabled; cannot safely instrument this artifact');
    }
    report.before = { executable: await digest(artifact.executable), archive: await digest(artifact.archive) };
    for (const [label, flag] of [['packaged-off', '0'], ['packaged-on-1', '1'], ['packaged-on-2', '1']]) {
      report.runs.push(await runLaunch(artifact, flag, label, evidence));
    }
    report.after = { executable: await digest(artifact.executable), archive: await digest(artifact.archive) };
    if (JSON.stringify(report.before) !== JSON.stringify(report.after)) throw new Error('Package changed during verification');
    report.status = report.runs.some(run => run.status === 2) ? 2 : report.runs.some(run => run.status === 1) ? 1 : 0;
  } catch (error) { report.errors.push(error.message); }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2));
  console.log(`Evidence: ${evidence}`);
  console.log(`Packaged E2E verification exit: ${report.status}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--app' || args[2] !== '--output') {
      throw new Error('Usage: node scripts/audit/verify-packaged-e2e.mjs --app <package-root> --output <fresh-evidence-directory>');
    }
    process.exitCode = (await verifyPackaged(args[1], args[3])).status;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
