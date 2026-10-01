// Real updater acceptance; restricted to disposable CI users. No production API.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveArtifact, recordParser, installBeforeEntry, requestNormalQuit, runtimeEnv, cleanupSpec, runLaunch, classifyRun } from './verify-packaged-e2e.mjs';
import { spawnOwnedWindows, waitOwnedJob, assertOwnedJob, terminateOwnedJob } from './windows-job.mjs';
import { hash, manifestFiles } from '../release/verify-fork-artifacts.mjs';
const require = createRequire(import.meta.url);
const identity = require('../../app.identity.json');
const { parse } = require('yaml');
const { assertSigning, baselineVersion } = require('../release/fork-policy.cjs');
const { run } = require('../release/run.cjs');
const bootstrap = fileURLToPath(new URL('./upgrade-security-bootstrap.cjs', import.meta.url));

export function feedFile(url, allowlist) {
  const parsed = new URL(url, 'http://127.0.0.1');
  const name = decodeURIComponent(parsed.pathname.slice(1));
  if (path.basename(name) !== name || /[/\\]|\.\./.test(name) || !allowlist.has(name)) return null;
  return name;
}

export async function verifyUpgrade(baseline, target, evidence) {
  const report = { status: 2, platform: process.platform, arch: process.arch,
    commit: process.env.GITHUB_SHA ?? null, errors: [] };
  fs.mkdirSync(evidence, { recursive: true });
  if (fs.existsSync(path.join(evidence, 'upgrade.json'))) throw new Error('Upgrade evidence must be fresh');
  let server, child, log, inspectorEndpoint;
  try {
    assertSigning(process.platform, process.env);
    if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') throw new Error('Installer acceptance requires a disposable GitHub CI user, not a developer profile');
    const mac = process.platform === 'darwin';
    const version = require('../../package.json').version;
    report.from = baselineVersion(version); report.to = version;
    const receipt = JSON.parse(fs.readFileSync(path.join(target, 'artifacts.json'), 'utf8'));
    if (receipt.status !== 0 || receipt.version !== version || receipt.commit !== report.commit) throw new Error('Verified target artifact receipt required');
    for (const file of receipt.artifacts) {
      if (path.basename(file.name) !== file.name || await hash(path.join(target, file.name)) !== file.sha256) throw new Error('Target changed since verification');
    }
    report.targetArtifacts = receipt.artifacts;
    const install = fs.mkdtempSync(path.join(evidence, 'install-'));
    const profile = fs.mkdtempSync(path.join(evidence, 'profile-'));
    fs.writeFileSync(path.join(profile, 'theme-config.json'), JSON.stringify({ mode: 'dark' }));
    let app;
    if (mac) {
      if (fs.existsSync(`/Applications/${identity.name}.app`)) throw new Error('Existing installed fork would compromise isolation');
      const archives = fs.readdirSync(baseline).filter(name => name.endsWith('.zip'));
      if (archives.length !== 1) throw new Error('Exactly one signed baseline ZIP required');
      run('/usr/bin/ditto', ['-x', '-k', path.join(baseline, archives[0]), install]);
      app = path.join(install, `${identity.name}.app`);
      run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
      run('/usr/bin/xcrun', ['stapler', 'validate', app]);
      const identity = run('/usr/bin/codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8', stdio: 'pipe' });
      if (!identity.stderr.includes(`Authority=${process.env.FORK_MAC_IDENTITY}`)) throw new Error('Wrong baseline identity');
    } else {
      const installers = fs.readdirSync(baseline).filter(name => name.endsWith('.exe'));
      if (installers.length !== 1) throw new Error('Exactly one signed baseline installer required');
      const powershell = path.win32.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      run(powershell, ['-NoProfile', '-NonInteractive', '-Command',
        "$existing=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName -eq $env:FORK_VERIFY_PRODUCT; if($existing){throw 'Existing fork installation'}; $s=Get-AuthenticodeSignature -LiteralPath $env:FORK_VERIFY_FILE; if($s.Status -ne 'Valid' -or $s.SignerCertificate.GetNameInfo('SimpleName',$false) -ne $env:FORK_WIN_PUBLISHER){throw 'Wrong baseline signature'}"],
        { env: { ...process.env, FORK_VERIFY_PRODUCT: identity.name, FORK_VERIFY_FILE: path.join(baseline, installers[0]) } });
      const baselineInstaller = spawnOwnedWindows(path.resolve(baseline, installers[0]), ['/S', `/D=${install}`], {
        cwd: install, env: runtimeEnv(process.env, profile, { main: path.join(install, 'unused-baseline-entry') }, '0') });
      const baselineLog = fs.createWriteStream(path.join(evidence, 'baseline-installer.log'));
      for (const stream of [baselineInstaller.stdout, baselineInstaller.stderr]) stream.on('data', chunk => baselineLog.write(chunk));
      try { await waitOwnedJob(baselineInstaller); }
      finally {
        report.baselineInstallerOwnership = baselineInstaller.ownership;
        await new Promise(resolve => baselineLog.end(resolve));
      }
      app = install;
    }
    const artifact = resolveArtifact(app);
    if (artifact.version !== report.from) throw new Error('Baseline version mismatch');
    report.baselineArchive = await hash(artifact.archive);
    const manifestName = mac ? 'latest-mac.yml' : 'latest.yml';
    const manifest = parse(fs.readFileSync(path.join(target, manifestName), 'utf8'));
    const allowed = new Set([manifestName, ...manifestFiles(manifest, version).map(file => file.url),
      ...receipt.artifacts.filter(file => file.name.endsWith('.blockmap')).map(file => file.name)]);
    server = http.createServer((request, response) => {
      const name = feedFile(request.url, allowed);
      if (!name || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end(); return; }
      const file = path.join(target, name);
      response.writeHead(200, { 'Content-Length': fs.statSync(file).size, 'Content-Type': 'application/octet-stream' });
      if (request.method === 'HEAD') response.end(); else fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    log = fs.createWriteStream(path.join(evidence, 'baseline.log'));
    child = (mac ? spawn : spawnOwnedWindows)(artifact.executable, ['--inspect-brk=127.0.0.1:0', `--user-data-dir=${profile}`], {
      cwd: install, detached: mac, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...runtimeEnv(process.env, profile, artifact, '1'), FORK_QA_PORT: String(port),
        FORK_QA_INSTALL: install, FORK_QA_TARGET_VERSION: version },
    });
    let endpointResolve, closeResolve;
    const endpoint = new Promise(resolve => { endpointResolve = resolve; });
    const closed = new Promise(resolve => { closeResolve = resolve; });
    child.on('error', error => { report.errors.push(error.message); closeResolve(); });
    child.on('close', (code, signal) => { report.baselineExit = { code, signal }; closeResolve(); });
    for (const stream of [child.stdout, child.stderr]) {
      const parser = recordParser((kind, value) => {
        if (kind === 'HARNESS') report.harness = value;
        if (kind === 'RESULT') report.baselineResult = value;
        if (kind === 'CLEAN-QUIT') report.cleanQuit = true;
        if (kind === 'PROBE-ERROR' || kind === 'INVALID' || kind === 'TIMEOUT') report.errors.push(value);
      }, line => {
        const url = line.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
        if (url) { inspectorEndpoint = url; endpointResolve(url); }
        if (line.startsWith('[UPGRADE-DOWNLOADED] ')) report.downloaded = JSON.parse(line.slice('[UPGRADE-DOWNLOADED] '.length));
        if (line.startsWith('[UPGRADE-INSTALLER] ')) report.installer = JSON.parse(line.slice('[UPGRADE-INSTALLER] '.length));
      });
      stream.on('data', chunk => { log.write(chunk); parser.push(chunk); });
      stream.on('end', () => parser.finish());
    }
    let timeout;
    try {
      await Promise.race([(async () => { await installBeforeEntry(await endpoint, artifact, bootstrap); await closed; })(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Upgrade launch timed out')), 180_000); })]);
    } finally { clearTimeout(timeout); }
    await new Promise(resolve => log.end(resolve));
    if (!mac) {
      report.upgradeOwnership = child.ownership; assertOwnedJob(child);
      if (!Number.isSafeInteger(report.installer?.pid) || report.installer.pid < 1 || !path.win32.isAbsolute(report.installer?.executable || '')
        || report.installer?.install !== install) throw new Error('Owned installer launch was not observed');
    }
    if (report.errors.length || report.baselineExit?.code !== 0 || report.baselineExit?.signal || !report.cleanQuit
      || report.harness?.packaged !== true || report.harness.profile !== profile || report.harness.entryFilename !== artifact.main
      || report.downloaded?.from !== report.from || report.downloaded?.to !== version
      || report.baselineResult?.themeMode !== 'dark') throw new Error('Incomplete isolated updater installation');
    if (classifyRun({ flag: '1', profile, errors: report.errors, harness: report.harness,
      result: report.baselineResult, exit: report.baselineExit, cleanQuit: report.cleanQuit,
      screenshot: fs.existsSync(path.join(profile, 'launcher.png')) }, artifact) !== 0) throw new Error('Baseline E2E exclusion failed');
    let updated;
    for (let attempt = 0; attempt < 90; attempt++) {
      try { updated = resolveArtifact(app); } catch { /* Installer may be swapping files; bounded polling. */ }
      if (updated?.version === version) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (updated?.version !== version) throw new Error('Installed application did not become the target version');
    if (await hash(updated.archive) !== await hash(receipt.application.archive)) throw new Error('Installed ASAR differs from verified target');
    if (await hash(updated.executable) !== await hash(receipt.application.executable)) throw new Error('Installed executable differs from verified target');
    const relaunched = await runLaunch(updated, '1', 'upgraded', evidence, profile);
    report.relaunch = relaunched;
    if (relaunched.status !== 0 || relaunched.result.themeMode !== 'dark'
      || JSON.parse(fs.readFileSync(path.join(profile, 'theme-config.json'), 'utf8')).mode !== 'dark') throw new Error('Relaunch, settings preservation or E2E exclusion failed');
    report.status = 0;
  } catch (error) { report.errors.push(error.message); }
  finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      if (child.connected) child.send({ type: 'natively-security-quit' }, () => {});
      else if (inspectorEndpoint && !child.ownership?.rootExit) {
        try { await requestNormalQuit(inspectorEndpoint); }
        catch (error) { report.errors.push(error.message); }
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (child.exitCode === null && child.signalCode === null) {
        report.status = 2;
        report.errors.push('Installer process required forced cleanup');
        try {
          if (child.terminateOwnedJob) {
            await terminateOwnedJob(child);
          } else {
            const spec = cleanupSpec(process.platform, child.pid);
            if (spec.command) run(spec.command, spec.args, { timeout: 10000 }); else process.kill(spec.group, spec.signal);
          }
        }
        catch (error) { report.errors.push(error.message); }
      }
    }
    if (child?.ownership) report.upgradeOwnership = child.ownership;
    if (log && !log.writableEnded) await new Promise(resolve => log.end(resolve));
    server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  }
  fs.writeFileSync(path.join(evidence, 'upgrade.json'), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [baseline, target, evidence] = process.argv.slice(2);
    if (!baseline || !target || !evidence || process.argv.length !== 5) throw new Error('Usage: verify-fork-upgrade.mjs <baseline-directory> <verified-target-directory> <fresh-evidence-directory>');
    process.exitCode = (await verifyUpgrade(baseline, target, evidence)).status;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
