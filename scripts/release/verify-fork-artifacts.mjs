import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveArtifact, verifyPackaged } from '../audit/verify-packaged-e2e.mjs';
const require = createRequire(import.meta.url);
const identity = require('../../app.identity.json');
const { parse } = require('yaml');
const { release, assertSigning, stableVersion } = require('./fork-policy.cjs');
const { run } = require('./run.cjs');

export async function hash(file, algorithm = 'sha256', encoding = 'hex') {
  const digest = crypto.createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest(encoding);
}

export function manifestFiles(manifest, version) {
  if (manifest.version !== stableVersion(version) || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Incorrect or empty updater manifest');
  return manifest.files.map(file => {
    if (typeof file.url !== 'string' || !file.url.startsWith(`${identity.name}-`) || path.basename(file.url) !== file.url || /[/\\]|\.\./.test(file.url)
      || !/^[A-Za-z0-9._-]+$/.test(file.url) || typeof file.sha512 !== 'string'
      || !Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('Unsafe updater manifest file');
    return file;
  });
}

export async function verifyArtifacts(directory, evidence, version = require('../../package.json').version) {
  const report = { status: 2, version, platform: process.platform, arch: process.arch,
    commit: process.env.GITHUB_SHA ?? null, artifacts: [], errors: [] };
  fs.mkdirSync(evidence, { recursive: true });
  if (fs.existsSync(path.join(evidence, 'artifacts.json'))) throw new Error('Evidence must be fresh');
  try {
    assertSigning(process.platform, process.env);
    const mac = process.platform === 'darwin';
    if (process.arch !== (mac ? 'arm64' : 'x64')) throw new Error('Unsupported artifact architecture');
    const manifestName = mac ? 'latest-mac.yml' : 'latest.yml';
    const manifest = parse(fs.readFileSync(path.join(directory, manifestName), 'utf8'));
    const files = manifestFiles(manifest, version);
    if (!files.some(file => file.url.endsWith(mac ? '.zip' : '.exe'))) throw new Error('Updater archive/installer missing');
    for (const file of files) {
      const artifact = path.join(directory, file.url);
      if (fs.statSync(artifact).size !== file.size || await hash(artifact, 'sha512', 'base64') !== file.sha512) throw new Error(`Updater hash mismatch: ${file.url}`);
    }
    const names = fs.readdirSync(directory).filter(name => name.endsWith(mac ? '.zip' : '.exe'));
    if (names.length !== 1) throw new Error('Expected exactly one updater payload');
    let app;
    if (mac) {
      const extracted = fs.mkdtempSync(path.join(evidence, 'zip-extracted-'));
      run('/usr/bin/ditto', ['-x', '-k', path.join(directory, names[0]), extracted]);
      app = path.join(extracted, `${identity.name}.app`);
      run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
      const details = run('/usr/bin/codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8', stdio: 'pipe' });
      if (!details.stderr.includes(`TeamIdentifier=${process.env.FORK_APPLE_TEAM_ID}`)
        || !details.stderr.includes(`Authority=${process.env.FORK_MAC_IDENTITY}`)) throw new Error('Wrong macOS signing identity');
      run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose', app]);
      run('/usr/bin/xcrun', ['stapler', 'validate', app]);
      const dmg = `${identity.name}-${version}-arm64.dmg`;
      run('/usr/bin/codesign', ['--verify', '--strict', path.join(directory, dmg)]);
      run('/usr/bin/xcrun', ['stapler', 'validate', path.join(directory, dmg)]);
      run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', path.join(directory, dmg)]);
    } else {
      app = path.join(directory, 'win-unpacked');
      for (const file of [path.join(directory, names[0]), path.join(app, `${identity.name}.exe`)]) {
        run(path.win32.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          ['-NoProfile', '-NonInteractive', '-Command', "$s=Get-AuthenticodeSignature -LiteralPath $env:FORK_VERIFY_FILE; if($s.Status -ne 'Valid' -or $s.SignerCertificate.GetNameInfo('SimpleName',$false) -ne $env:FORK_WIN_PUBLISHER){throw 'Invalid signature or publisher'}"],
          { env: { ...process.env, FORK_VERIFY_FILE: file } });
      }
    }
    const artifact = resolveArtifact(app);
    if (artifact.version !== version) throw new Error('Packaged version mismatch');
    if (artifact.appId !== identity.appId || artifact.name !== identity.packageName) throw new Error('Packaged fork identity mismatch');
    const config = parse(fs.readFileSync(path.join(artifact.resources, 'app-update.yml'), 'utf8'));
    if (config.provider !== 'github' || config.owner !== release.owner || config.repo !== release.repo
      || (!mac && ![config.publisherName].flat().includes(process.env.FORK_WIN_PUBLISHER))) throw new Error('Incorrect feed/publisher in packaged updater configuration');
    const exclusion = await verifyPackaged(app, path.join(evidence, 'packaged-e2e'));
    if (exclusion.status !== 0) throw new Error('Final updater application failed packaged E2E acceptance');
    report.application = artifact;
    const extensions = mac ? /\.(zip|dmg|blockmap)$|^latest-mac\.yml$/ : /\.(exe|blockmap)$|^latest\.yml$/;
    for (const name of fs.readdirSync(directory).filter(name => extensions.test(name))) {
      report.artifacts.push({ name, size: fs.statSync(path.join(directory, name)).size, sha256: await hash(path.join(directory, name)) });
    }
    if (!report.artifacts.some(file => file.name.endsWith('.blockmap'))) throw new Error('Updater blockmap missing');
    report.status = 0;
  } catch (error) { report.errors.push(error.message); }
  fs.writeFileSync(path.join(evidence, 'artifacts.json'), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [directory, evidence] = process.argv.slice(2);
    if (!directory || !evidence || process.argv.length !== 4) throw new Error('Usage: verify-fork-artifacts.mjs <release-directory> <fresh-evidence-directory>');
    process.exitCode = (await verifyArtifacts(directory, evidence)).status;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
