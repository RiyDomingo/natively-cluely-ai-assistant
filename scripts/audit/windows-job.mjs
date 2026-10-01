import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordParser } from './verify-packaged-e2e.mjs';

export function quoteWindowsArgument(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid Windows argument');
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

export function spawnOwnedWindows(executable, args, options, spawnImpl = spawn) {
  if (!path.win32.isAbsolute(executable) || !path.win32.isAbsolute(options.cwd)) throw new Error('Owned Windows launch requires absolute paths');
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new Error('Windows system directory unavailable');
  const host = spawnImpl(path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./windows-job.ps1', import.meta.url))],
    { cwd: options.cwd, env: { SystemRoot: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] });
  host.ownership = { confirmed: false, empty: false, forced: false, errors: [], rootExit: null };
  const makeParser = () => recordParser(() => {}, line => {
    try {
      if (line.startsWith('[OWNED-JOB] ')) {
        const record = JSON.parse(line.slice(12));
        if (record.contained !== true || record.executable !== executable || !Number.isSafeInteger(record.pid) || record.pid < 1) throw new Error('Invalid containment receipt');
        host.ownership.confirmed = true; host.ownership.pid = record.pid;
      }
      if (line.startsWith('[OWNED-ROOT-EXIT] ')) host.ownership.rootExit = JSON.parse(line.slice(18));
      if (line === '[OWNED-JOB-EMPTY]') host.ownership.empty = true;
      if (line === '[OWNED-JOB-FORCED]') host.ownership.forced = true;
      if (line.startsWith('[OWNED-JOB-ERROR] ')) host.ownership.errors.push(line);
    } catch (error) { host.ownership.errors.push(error.message); }
  });
  for (const stream of [host.stdout, host.stderr]) {
    const parser = makeParser();
    stream.on('data', chunk => parser.push(chunk));
    stream.on('end', () => parser.finish());
  }
  host.stdin.on('error', error => host.ownership.errors.push(error.message));
  host.stdin.write(JSON.stringify({ executable, commandLine: [executable, ...args].map(quoteWindowsArgument).join(' '), cwd: options.cwd, env: options.env }) + '\n');
  host.terminateOwnedJob = () => { host.ownership.forced = true; host.stdin.end('terminate\n'); };
  return host;
}

export function assertOwnedJob(child) {
  const record = child.ownership;
  if (!record?.confirmed || !record.empty || record.forced || record.errors.length || !record.rootExit
    || record.rootExit.pid !== record.pid || record.rootExit.code !== 0) {
    throw new Error('Windows process containment or clean installer completion was not verified');
  }
}

export async function waitOwnedJob(child, timeoutMs = 180_000) {
  let timer;
  try {
    await Promise.race([
      new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`Owned Windows process failed (${code})`))); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned Windows process timed out')), timeoutMs); }),
    ]);
    assertOwnedJob(child);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      await terminateOwnedJob(child);
    }
  }
}

export async function terminateOwnedJob(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(resolve => child.once('close', () => resolve(true)));
  child.terminateOwnedJob();
  const wait = async () => {
    let timer;
    try { return await Promise.race([closed, new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]); }
    finally { clearTimeout(timer); }
  };
  if (await wait()) return;
  // Closing this exact owned controller closes its non-inheritable job handle,
  // invoking KILL_ON_JOB_CLOSE. Never target an application/installer by name.
  child.kill('SIGKILL');
  if (!await wait()) throw new Error('Owned Windows job controller did not terminate');
}
