// Protected CI only. Credentials are materialized outside the checkout and
// never printed, uploaded, or passed to renderer builds.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { assertContext, assertSigning } = require('./fork-policy.cjs');
const { run } = require('./run.cjs');

async function main() {
  const env = process.env;
  const version = require('../../package.json').version;
  assertContext(env, version);
  if (env.FORK_RELEASE_VERSION !== version) throw new Error('Requested version must equal package.json');
  const mac = process.platform === 'darwin';
  if ((mac && process.arch !== 'arm64') || (!mac && (process.platform !== 'win32' || process.arch !== 'x64'))) throw new Error('Unsupported release host');
  const tmp = fs.mkdtempSync(path.join(env.RUNNER_TEMP, 'fork-signing-'));
  let keychain, originalKeychains;
  try {
    const certKey = mac ? 'FORK_MAC_CERT_BASE64' : 'FORK_WIN_CERT_BASE64';
    if (!env[certKey]) throw new Error(`Required signing setting missing: ${certKey}`);
    const cert = path.join(tmp, 'certificate.p12');
    fs.writeFileSync(cert, Buffer.from(env[certKey], 'base64'), { mode: 0o600 });
    env[mac ? 'FORK_MAC_CERT_FILE' : 'FORK_WIN_CERT_FILE'] = cert;
    if (mac) {
      if (!env.FORK_NOTARY_KEY_BASE64) throw new Error('Required signing setting missing: FORK_NOTARY_KEY_BASE64');
      env.FORK_NOTARY_KEY_FILE = path.join(tmp, 'AuthKey.p8');
      fs.writeFileSync(env.FORK_NOTARY_KEY_FILE, Buffer.from(env.FORK_NOTARY_KEY_BASE64, 'base64'), { mode: 0o600 });
    }
    assertSigning(process.platform, env);
    if (mac) {
      run('brew', ['install', 'create-dmg']);
      originalKeychains = execFileSync('/usr/bin/security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' })
        .match(/"[^"]+"/g)?.map(value => value.slice(1, -1));
      if (!originalKeychains?.length) throw new Error('Cannot preserve keychain search list');
      keychain = path.join(tmp, 'fork-signing.keychain-db');
      const password = crypto.randomBytes(32).toString('hex');
      run('/usr/bin/security', ['create-keychain', '-p', password, keychain], { stdio: 'ignore' });
      run('/usr/bin/security', ['unlock-keychain', '-p', password, keychain], { stdio: 'ignore' });
      run('/usr/bin/security', ['set-keychain-settings', '-lut', '21600', keychain], { stdio: 'ignore' });
      run('/usr/bin/security', ['import', cert, '-P', env.FORK_MAC_CERT_PASSWORD, '-A', '-t', 'cert', '-f', 'pkcs12', '-k', keychain], { stdio: 'ignore' });
      run('/usr/bin/security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain], { stdio: 'ignore' });
      run('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', keychain, ...originalKeychains], { stdio: 'ignore' });
    }
    const target = mac ? '--mac' : '--win';
    run(process.execPath, ['scripts/package-app.js', '--config', 'electron-builder.fork-signed.cjs', target, `--${process.arch}`, '--publish', 'never']);
    const evidence = path.join(env.RUNNER_TEMP, 'fork-release-evidence');
    run(process.execPath, ['scripts/release/verify-fork-artifacts.mjs', 'release', evidence]);
    fs.copyFileSync(path.join(evidence, 'artifacts.json'), path.join('release', 'artifacts.json'));
    run(process.execPath, ['scripts/package-app.js', '--config', 'electron-builder.fork-baseline.cjs', target, `--${process.arch}`, '--publish', 'never']);
    run(process.execPath, ['scripts/audit/verify-fork-upgrade.mjs', 'release-baseline', 'release', path.join(evidence, 'upgrade')]);
    fs.copyFileSync(path.join(evidence, 'upgrade', 'upgrade.json'), path.join('release', 'upgrade.json'));
    const shipping = JSON.parse(fs.readFileSync(path.join('release', 'artifacts.json'), 'utf8'));
    // Final receipt explicitly binds installation acceptance to these exact bytes.
    if (shipping.commit !== env.GITHUB_SHA) throw new Error('Unexpected receipt commit');
  } finally {
    try {
      if (keychain) {
        try {
          if (originalKeychains) run('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...originalKeychains], { stdio: 'ignore' });
        } finally { run('/usr/bin/security', ['delete-keychain', keychain], { stdio: 'ignore' }); }
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); } // Exactly this owned secret directory.
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
