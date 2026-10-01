import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runtimeEnv, recordParser } from './verify-packaged-e2e.mjs';
import { stopOwned } from '../dev-app.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
async function reachable() {
  return new Promise(resolve => {
    const request = http.get('http://localhost:5180', response => { response.resume(); resolve(true); });
    request.setTimeout(1000, () => request.destroy()); request.on('error', () => resolve(false));
  });
}
export async function verifyDevRestart(npm, evidence, flag = '0') {
  if (!['0', '1'].includes(flag)) throw new Error('Development E2E flag must be 0 or 1');
  if (await reachable()) throw new Error('Port 5180 is already in use; refusing to disturb an existing server');
  fs.mkdirSync(evidence, { recursive: true });
  const profile = fs.mkdtempSync(path.join(evidence, 'profile-'));
  const log = fs.createWriteStream(path.join(evidence, 'development.log'));
  const report = { platform: process.platform, flag, profile, status: 2, ready: [], errors: [] };
  const artifact = { main: path.join(root, pkg.main) };
  const env = runtimeEnv(process.env, profile, artifact, flag);
  Object.assign(env, { NATIVELY_SECURITY_ARTIFACT: '0', NATIVELY_SECURITY_DEBUGGER: '1',
    NODE_OPTIONS: `--require=${JSON.stringify(fileURLToPath(new URL('./dev-restart-bootstrap.cjs', import.meta.url)))}` });
  const child = spawn(process.execPath, [npm, 'start'], { cwd: root, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => {
    child.on('error', error => { report.errors.push(error.message); resolve(); });
    child.once('close', (code, signal) => { report.exit = { code, signal }; resolve(); });
  });
  for (const stream of [child.stdout, child.stderr]) {
    const parser = recordParser((kind, value) => {
      if (['PROBE-ERROR', 'TIMEOUT', 'INVALID'].includes(kind)) report.errors.push(value);
    }, line => {
      if (line.startsWith('[DEV-RESTART-READY] ')) report.ready.push(JSON.parse(line.slice('[DEV-RESTART-READY] '.length)));
      if (/ERR_CONNECTION_REFUSED|Could not resolve/.test(line)) report.errors.push(line);
    });
    stream.on('data', chunk => { log.write(chunk); parser.push(chunk); }); stream.on('end', () => parser.finish());
  }
  let timer;
  try {
    await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Development restart smoke timed out')), 180000); })]);
    if (report.exit?.code !== 0 || report.exit.signal || report.ready.length !== 2 || report.ready.some((item, index) => item.count !== index + 1 || !item.visible
      || item.bridge !== (flag === '1' ? 'function' : 'undefined') || flag === '1' && item.productionRejected !== true)
      || ![1, 2].every(count => fs.existsSync(path.join(profile, `launcher-${count}.png`))) || report.errors.length || await reachable()) {
      throw new Error('Development restart or final server shutdown was not verified');
    }
    report.status = 0;
  } catch (error) { report.errors.push(error.message); }
  finally { clearTimeout(timer); await stopOwned(child); await new Promise(resolve => log.end(resolve)); }
  fs.writeFileSync(path.join(evidence, 'restart.json'), JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [npm, evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-restart-')), flag = '0'] = process.argv.slice(2);
  if (!npm || !path.isAbsolute(npm)) { console.error('Usage: verify-dev-restart.mjs <absolute-npm-cli.js> [evidence-directory] [0|1]'); process.exitCode = 2; }
  else {
    try { const report = await verifyDevRestart(npm, path.resolve(evidence), flag); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.status; }
    catch (error) { console.error(error.message); process.exitCode = 2; }
  }
}
