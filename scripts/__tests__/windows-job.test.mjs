import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnOwnedWindows, assertOwnedJob, waitOwnedJob, quoteWindowsArgument } from '../audit/windows-job.mjs';

test('Windows command-line quoting preserves spaces, quotes and trailing slashes', () => {
  assert.equal(quoteWindowsArgument('C:\\App Folder\\'), '"C:\\App Folder\\\\"');
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
  assert.throws(() => quoteWindowsArgument('bad\0arg'));
});
function mockHost() {
  const child = new EventEmitter(); Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
  child.stdin.on('data', () => {});
  return child;
}
test('split receipts independently observe root exit and live detached descendants', async () => {
  const previous = process.env.SystemRoot; process.env.SystemRoot = 'C:\\Windows';
  try {
    const host = mockHost(); let command;
    const owned = spawnOwnedWindows('C:\\App Folder\\Natively.exe', [], { cwd: 'C:\\Owned', env: { TEMP: 'C:\\Temp' } }, (exe, args, opts) => { command = { exe, args, opts }; return host; });
    assert.match(command.exe, /WindowsPowerShell/); assert.equal(command.opts.stdio[0], 'pipe');
    const receipt = '[OWNED-JOB] ' + JSON.stringify({ pid: 100, contained: true, executable: 'C:\\App Folder\\Natively.exe' }) + '\n';
    host.stdout.write(receipt.slice(0, 10)); host.stderr.write('unrelated stderr\n'); host.stdout.write(receipt.slice(10));
    host.stdout.write('[OWNED-ROOT-EXIT] {"pid":100,"code":0}\n');
    assert.equal(owned.ownership.confirmed, true); assert.throws(() => assertOwnedJob(owned), /completion/);
    // Root completion is insufficient while detached descendants remain alive.
    host.stdout.write('[OWNED-JOB-EMPTY]\n'); assertOwnedJob(owned);
    host.stdout.write('[OWNED-JOB-FORCED]\n'); assert.throws(() => assertOwnedJob(owned));
  } finally { if (previous === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = previous; }
});
test('stalled installer closes only its owned job; unrelated processes are not targeted', async () => {
  const child = mockHost(); let terminated = false;
  child.terminateOwnedJob = () => { terminated = true; setImmediate(() => { child.exitCode = 2; child.emit('close', 2); }); };
  await assert.rejects(waitOwnedJob(child, 10), /timed out/); assert.equal(terminated, true);
});
test('missing, failed or escaped containment cannot pass', () => {
  for (const record of [undefined, { confirmed: false }, { confirmed: true, empty: false }, { confirmed: true, empty: true, forced: false, errors: ['escape'] }]) {
    assert.throws(() => assertOwnedJob({ ownership: record }));
  }
  const source = fs.readFileSync(new URL('../audit/windows-job.ps1', import.meta.url), 'utf8');
  assert.ok(source.indexOf('AssignProcessToJobObject($job') < source.indexOf('ResumeThread($info.thread)'));
  assert.match(source, /KILL_ON_JOB_CLOSE; no breakaway/);
  assert.doesNotMatch(source, /Stop-Process|taskkill|BREAKAWAY_OK/);
});
test('actual Windows job retains detached installer-like child after root exits', { skip: process.platform !== 'win32' }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-job-test-'));
  const child = spawnOwnedWindows(process.execPath, ['-e', "require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},750)'],{detached:true,stdio:'ignore'}).unref()"], { cwd: work, env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, PATH: process.env.PATH } });
  const started = Date.now();
  await waitOwnedJob(child, 30000);
  assert.ok(Date.now() - started >= 750); assert.equal(child.ownership.rootExit.code, 0); assert.equal(child.ownership.empty, true);
});
