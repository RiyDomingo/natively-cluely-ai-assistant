import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { hash } from './verify-fork-artifacts.mjs';
const require = createRequire(import.meta.url);
const { release, assertContext, assertReleaseVersion } = require('./fork-policy.cjs');

export async function acceptedArtifacts(directory, version, commit) {
  const accepted = [];
  for (const platform of ['darwin', 'win32']) {
    const dir = path.join(directory, platform);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'artifacts.json'), 'utf8'));
    const upgrade = JSON.parse(fs.readFileSync(path.join(dir, 'upgrade.json'), 'utf8'));
    if (report.status !== 0 || report.version !== version || report.commit !== commit || report.platform !== platform
      || report.arch !== (platform === 'darwin' ? 'arm64' : 'x64') || upgrade.status !== 0
      || upgrade.platform !== platform || upgrade.arch !== report.arch || upgrade.commit !== commit
      || upgrade.to !== version || !upgrade.relaunch || upgrade.relaunch.status !== 0
      || !upgrade.relaunch.cleanQuit || upgrade.relaunch.result?.themeMode !== 'dark'
      || JSON.stringify(upgrade.targetArtifacts) !== JSON.stringify(report.artifacts)) throw new Error(`Incomplete ${platform} release/upgrade acceptance`);
    for (const file of report.artifacts) {
      if (path.basename(file.name) !== file.name || !/^[A-Za-z0-9._-]+$/.test(file.name)
        || accepted.some(previous => previous.name === file.name)) throw new Error('Unsafe or duplicate release asset');
      const full = path.join(dir, file.name);
      if (fs.statSync(full).size !== file.size || await hash(full) !== file.sha256) throw new Error('Release asset changed after acceptance');
      accepted.push({ ...file, full });
    }
  }
  for (const suffix of ['.zip', '.dmg', '.exe', '.blockmap']) if (!accepted.some(file => file.name.endsWith(suffix))) throw new Error(`Missing ${suffix} release asset`);
  for (const name of ['latest.yml', 'latest-mac.yml']) if (!accepted.some(file => file.name === name)) throw new Error(`Missing ${name}`);
  return accepted;
}

export async function publish(directory, apiFetch = (url, options) => fetch(url, {
  ...options, redirect: 'error', signal: AbortSignal.timeout(10 * 60 * 1000),
})) {
  const env = process.env;
  const version = require('../../package.json').version;
  assertContext(env, version);
  if (env.FORK_RELEASE_VERSION !== version || !env.GITHUB_TOKEN) throw new Error('Explicit version and release-scoped token required');
  const assets = await acceptedArtifacts(directory, version, env.GITHUB_SHA);
  const base = `https://api.github.com/repos/${release.owner}/${release.repo}`;
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  // Public client access is mandatory. Never distribute a private-repo token.
  const publicRepo = await apiFetch(base, { headers });
  if (!publicRepo.ok || (await publicRepo.json()).private !== false) throw new Error('Release repository is not publicly readable');
  const authorized = { ...headers, 'Content-Type': 'application/json', Authorization: `Bearer ${env.GITHUB_TOKEN}` };
  const existing = await apiFetch(`${base}/releases/tags/v${version}`, { headers: authorized });
  if (existing.status !== 404) throw new Error('Release/tag already exists or cannot be conclusively checked; refuse replacement');
  const tag = await apiFetch(`${base}/git/ref/tags/v${version}`, { headers: authorized });
  if (tag.status !== 404) throw new Error('Tag already exists or cannot be checked; refuse overwrite');
  for (let page = 1; ; page++) {
    if (page > 10) throw new Error('Release history too large for bounded version audit');
    const response = await apiFetch(`${base}/releases?per_page=100&page=${page}`, { headers: authorized });
    if (!response.ok) throw new Error('Cannot inspect release history');
    const releases = await response.json();
    for (const previous of releases.filter(item => !item.draft && !item.prerelease)) assertReleaseVersion(version, previous.tag_name.replace(/^v/, ''));
    if (releases.length < 100) break;
  }
  const notes = `Patched public Natively ${version}\n\nUpstream base: ${release.upstreamBase}.\nSource commit: ${env.GITHUB_SHA}.\n\nPreserved: optional Premium/free-build fallback; packaged E2E exclusion.\nVerified: macOS arm64 and Windows x64 signed artifacts, installer/update acceptance.\nFirst fork installation is manual; do not run alongside the official app.\n`;
  const created = await apiFetch(`${base}/releases`, { method: 'POST', headers: authorized,
    body: JSON.stringify({ tag_name: `v${version}`, target_commitish: env.GITHUB_SHA, name: `Natively ${version} (patched)`, body: notes, draft: true, prerelease: false }) });
  if (!created.ok) throw new Error('Draft release creation failed');
  const draft = await created.json();
  if (!Number.isSafeInteger(draft.id) || draft.draft !== true || draft.assets?.length) throw new Error('Unexpected draft release response');
  // Upload to the fixed GitHub endpoint, not a response-controlled URL.
  for (const file of assets) {
    const uploaded = await apiFetch(`https://uploads.github.com/repos/${release.owner}/${release.repo}/releases/${draft.id}/assets?name=${encodeURIComponent(file.name)}`, {
      method: 'POST', headers: { ...authorized, 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size) },
      body: fs.createReadStream(file.full), duplex: 'half',
    });
    if (!uploaded.ok) throw new Error(`Asset upload failed; release remains draft: ${file.name}`);
    const remote = await uploaded.json();
    if (remote.state !== 'uploaded' || remote.size !== file.size || remote.digest !== `sha256:${file.sha256}`) throw new Error('Uploaded asset integrity unconfirmed; release remains draft');
  }
  // A draft may not create its tag until publication. Pin the tag explicitly
  // after acceptance and uploads; a concurrent existing/mismatched ref blocks.
  const pinned = await apiFetch(`${base}/git/ref/tags/v${version}`, { headers: authorized });
  if (pinned.status === 404) {
    const createdTag = await apiFetch(`${base}/git/refs`, { method: 'POST', headers: authorized,
      body: JSON.stringify({ ref: `refs/tags/v${version}`, sha: env.GITHUB_SHA }) });
    if (!createdTag.ok || (await createdTag.json()).object?.sha !== env.GITHUB_SHA) throw new Error('Cannot pin immutable release commit; draft retained');
  } else {
    if (!pinned.ok || (await pinned.json()).object?.sha !== env.GITHUB_SHA) throw new Error('Release tag points at another commit; draft retained');
  }
  const published = await apiFetch(`${base}/releases/${draft.id}`, { method: 'PATCH', headers: authorized,
    body: JSON.stringify({ draft: false, make_latest: 'true' }) });
  if (!published.ok || (await published.json()).draft !== false) throw new Error('Publication failed or inconclusive; inspect draft manually');
  console.log(`Published fork release v${version}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: publish-fork.mjs <accepted-artifact-root>');
    await publish(process.argv[2]);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
