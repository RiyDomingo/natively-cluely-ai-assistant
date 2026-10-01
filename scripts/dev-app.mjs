// Own the development server independently of Electron's restart lifecycle.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));

export function createSupervisor({ startElectron, stopServer, stopElectron, onError = console.error }) {
  let child, restarting = false, stopping = false;
  let finishedResolve;
  const finished = new Promise(resolve => { finishedResolve = resolve; });
  const stop = async (code = 0) => {
    if (stopping) return finished;
    stopping = true;
    try { await Promise.all([stopElectron(child), stopServer()]); }
    catch (error) { onError(error); code = 1; }
    finishedResolve(code);
    return finished;
  };
  const launch = () => {
    if (stopping) return;
    restarting = false;
    try { child = startElectron(); } catch (error) { onError(error); void stop(1); return; }
    const current = child;
    child.on('message', message => {
      if (current === child && !stopping && message?.type === 'natively-dev-restart') restarting = true;
    });
    child.once('error', error => { onError(error); void stop(1); });
    child.once('close', (code, signal) => {
      if (current !== child || stopping) return;
      if (restarting && code === 0 && !signal) launch();
      else void stop(code === 0 && !signal ? 0 : 1);
    });
  };
  return { launch, stop, finished };
}

export function cleanupCommand(platform, pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid owned PID');
  if (platform === 'win32') return ['taskkill.exe', ['/PID', String(pid), '/T', '/F']];
  if (platform === 'darwin' || platform === 'linux') return null;
  throw new Error(`Unsupported development platform: ${platform}`);
}

export async function stopOwned(child, platform = process.platform) {
  if (!child || !Number.isSafeInteger(child.pid) || child.pid < 1 || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  if (child.connected) child.send({ type: 'natively-dev-quit' }, () => {});
  else if (platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  // Windows has no POSIX SIGTERM for CLI servers. Keep the root alive until
  // taskkill can address its exact owned tree rather than orphaning helpers.
  let timer;
  const exited = await Promise.race([closed.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
  clearTimeout(timer);
  if (exited || child.exitCode !== null || child.signalCode !== null) return;
  const command = cleanupCommand(platform, child.pid);
  if (command) {
    await new Promise((resolve, reject) => {
      const killer = spawn(command[0], command[1], { stdio: 'inherit', timeout: 10000 });
      killer.once('error', reject); killer.once('close', code => code === 0 ? resolve() : reject(new Error('Owned process cleanup failed')));
    });
  } else process.kill(-child.pid, 'SIGKILL');
  let finalTimer;
  try {
    await Promise.race([closed, new Promise((_, reject) => { finalTimer = setTimeout(() => reject(new Error('Owned process did not close after cleanup')), 5000); })]);
  } finally { clearTimeout(finalTimer); }
}

export function waitForServer(server, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let timer, request, done = false, output = '', listening = false;
    const deadlineTimer = setTimeout(() => finish(new Error('Development server startup timed out')), timeoutMs);
    const finish = error => {
      if (done) return; done = true; clearTimeout(timer); clearTimeout(deadlineTimer); request?.destroy();
      server.stdout?.off('data', onOutput);
      server.off('close', failed); server.off('error', failed);
      error ? reject(error) : resolve();
    };
    const failed = () => finish(new Error('Development server stopped before startup'));
    server.once('close', failed); server.once('error', failed);
    const poll = () => {
      if (Date.now() >= deadline) { finish(new Error('Development server startup timed out')); return; }
      request = http.get('http://localhost:5180', response => {
        response.resume();
        if (response.statusCode === 200) finish(); else timer = setTimeout(poll, 200);
      });
      request.setTimeout(1000, () => request.destroy());
      request.once('error', () => { if (!done) timer = setTimeout(poll, 200); });
    };
    const onOutput = chunk => {
      output = (output + chunk.toString()).slice(-4096);
      if (!listening && /Local:\s+http:\/\/localhost:5180\//.test(output.replace(/\x1b\[[0-9;]*m/g, ''))) {
        listening = true; poll();
      }
    };
    server.stdout.on('data', onOutput);
  });
}

export async function main() {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Start development with npm start');
  let building, server, supervisor;
  const options = { cwd: root, detached: process.platform !== 'win32', stdio: 'inherit' };
  let cancelled = false;
  const interrupt = () => {
    cancelled = true;
    void (supervisor ? supervisor.stop(0) : Promise.all([stopOwned(building), stopOwned(server)]))
      .catch(error => { console.error(error); process.exitCode = 1; });
  };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    for (const task of ['build', 'build:electron']) {
      if (cancelled) return;
      building = spawn(process.execPath, [npm, 'run', task], options);
      await new Promise((resolve, reject) => {
        building.once('error', reject);
        building.once('close', code => code === 0 ? resolve() : reject(new Error(`${task} failed (${code})`)));
      });
    }
    if (cancelled) return;
    server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', '5180', '--strictPort'], { ...options, stdio: ['ignore', 'pipe', 'inherit'] });
    server.stdout.pipe(process.stdout);
    await waitForServer(server);
    supervisor = createSupervisor({
      startElectron: () => spawn(require('electron'), ['.'], { ...options, stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env, NODE_ENV: 'development', NATIVELY_DEV_SUPERVISOR: '1' } }),
      stopServer: () => stopOwned(server), stopElectron: stopOwned,
    });
    server.once('close', () => { void supervisor.stop(1); });
    server.on('error', error => { console.error(error); void supervisor.stop(1); });
    supervisor.launch();
    process.exitCode = await supervisor.finished;
  } finally {
    await Promise.all([stopOwned(building), stopOwned(server)]);
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
