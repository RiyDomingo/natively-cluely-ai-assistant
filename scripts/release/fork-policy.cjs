const fs = require('node:fs');
const semver = require('semver');
const release = require('../../release.config.json');

function stableVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
    || !semver.valid(version)) throw new Error('A numeric stable version is required');
  return version;
}

function assertReleaseVersion(version, previous) {
  stableVersion(version);
  if (semver.lt(version, '2.8.9')) throw new Error('Fork releases start at 2.8.9');
  if (previous && !semver.gt(version, stableVersion(previous))) throw new Error('Release must be newer than the previous release');
}

function baselineVersion(version) {
  const [major, minor, patch] = stableVersion(version).split('.').map(Number);
  if (patch > 0) return `${major}.${minor}.${patch - 1}`;
  if (minor > 0) return `${major}.${minor - 1}.0`;
  if (major > 0) return `${major - 1}.0.0`;
  throw new Error('Cannot produce an older acceptance baseline');
}

function assertSigning(platform, env, checkFiles = true) {
  if (!['darwin', 'win32'].includes(platform)) throw new Error('Unsupported fork release platform');
  for (const flag of ['NATIVELY_SKIP_NOTARIZE', 'NATIVELY_SKIP_NOTARY_PREFLIGHT']) {
    if (env[flag]) throw new Error(`Fork release forbids ${flag}`);
  }
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') throw new Error('Signing cannot be disabled');
  const keys = platform === 'darwin'
    ? ['FORK_MAC_CERT_FILE', 'FORK_MAC_CERT_PASSWORD', 'FORK_MAC_IDENTITY', 'FORK_APPLE_TEAM_ID', 'FORK_NOTARY_KEY_FILE', 'FORK_NOTARY_KEY_ID', 'FORK_NOTARY_ISSUER']
    : ['FORK_WIN_CERT_FILE', 'FORK_WIN_CERT_PASSWORD', 'FORK_WIN_PUBLISHER'];
  for (const key of keys) if (typeof env[key] !== 'string' || !env[key].trim()) throw new Error(`Required signing setting missing: ${key}`);
  if (platform === 'darwin' && (!/^[A-Z0-9]{10}$/.test(env.FORK_APPLE_TEAM_ID)
    || !env.FORK_MAC_IDENTITY.startsWith('Developer ID Application:')
    || !env.FORK_MAC_IDENTITY.endsWith(`(${env.FORK_APPLE_TEAM_ID})`))) throw new Error('Developer ID identity must match the explicit fork Team ID');
  if (checkFiles) for (const key of keys.filter(key => key.endsWith('_FILE'))) {
    if (!fs.statSync(env[key]).isFile()) throw new Error(`Signing file missing: ${key}`);
  }
}

function assertContext(env, version) {
  assertReleaseVersion(version);
  if (env.GITHUB_REPOSITORY !== `${release.owner}/${release.repo}`
    || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main'
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) throw new Error('Fork releases require a manual dispatch from this repository main commit');
  if (env.FORK_DISTRIBUTION_AUTHORIZED !== 'true') throw new Error('Repository owner distribution authorization is required');
}

module.exports = { release, stableVersion, baselineVersion, assertReleaseVersion, assertSigning, assertContext };

if (require.main === module) {
  try {
    assertContext(process.env, require('../../package.json').version);
    assertSigning(process.platform, process.env);
    if ((process.platform === 'darwin' && process.arch !== 'arm64')
      || (process.platform === 'win32' && process.arch !== 'x64')) throw new Error('Unexpected release runner architecture');
    console.log('Fork release/signing preflight passed');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
