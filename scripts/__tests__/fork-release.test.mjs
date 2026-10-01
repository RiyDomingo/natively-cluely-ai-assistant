import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { manifestFiles, hash } from '../release/verify-fork-artifacts.mjs';
import { feedFile } from '../audit/verify-fork-upgrade.mjs';
import { acceptedArtifacts, publish } from '../release/publish-fork.mjs';
const require = createRequire(import.meta.url);
const { release, assertSigning, assertContext, assertReleaseVersion, baselineVersion } = require('../release/fork-policy.cjs');
const publicConfig = require('../../electron-builder.public.cjs');
const workflowSource = fs.readFileSync(new URL('../../.github/workflows/fork-release.yml', import.meta.url), 'utf8');
const workflow = require('yaml').parse(workflowSource);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('public build feed and notes share the sole fork configuration', () => {
  assert.equal(publicConfig.publish[0].owner, release.owner);
  assert.equal(publicConfig.publish[0].repo, release.repo);
  assert.equal(publicConfig.publish[0].channel, release.channel);
  const defaultFeed = require('../../package.json').build.publish[0];
  assert.equal(defaultFeed.owner, release.owner);
  assert.equal(defaultFeed.repo, release.repo);
  assert.equal(defaultFeed.channel, release.channel);
  assert.equal(defaultFeed.releaseType, 'draft');
  assert.deepEqual(publicConfig.extraMetadata.forkRelease, release);
  assert.equal(publicConfig.extraMetadata.nativelySigned, false);
  const wrapper = fs.readFileSync(new URL('../package-app.js', import.meta.url), 'utf8');
  assert.match(wrapper, /electron-builder\.public\.cjs/);
  for (const file of ['electron/update/ReleaseNotesManager.ts', 'src/components/UpdateBanner.tsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /Natively-AI-assistant/);
  }
});
test('release URLs stay on the fork and reject malformed tags/unsupported assets', () => {
  const { outputFiles } = require('esbuild').buildSync({ entryPoints: [path.join(root, 'src/config/release.ts')], bundle: true, platform: 'node', format: 'cjs', write: false });
  const module = { exports: {} }; vm.runInNewContext(outputFiles[0].text, { module, exports: module.exports });
  const api = module.exports;
  assert.equal(api.releaseApiUrl('v2.8.9'), 'https://api.github.com/repos/RiyDomingo/zatively-cluely-ai-assistant/releases/tags/v2.8.9');
  assert.equal(api.REPOSITORY_URL, 'https://github.com/RiyDomingo/zatively-cluely-ai-assistant');
  assert.match(api.macReleaseDownloadUrl('2.8.9', 'arm64'), /RiyDomingo.*Zatively-2.8.9-arm64\.dmg$/);
  for (const version of ['../../evil', 'https://evil.test', '2.8.9-beta.1']) {
    assert.throws(() => api.releaseApiUrl(version));
    assert.equal(api.macReleaseDownloadUrl(version, 'arm64'), api.LATEST_RELEASE_URL);
  }
  assert.equal(api.macReleaseDownloadUrl('2.8.9', 'x64'), api.LATEST_RELEASE_URL);
});
test('stable numeric versions increase; equal/older/malformed versions fail', () => {
  assertReleaseVersion('2.8.9'); assertReleaseVersion('2.8.10', '2.8.9');
  for (const value of ['2.8.8', '2.8.9+patched', '2.8.9-beta.1', '02.8.9', '', undefined]) assert.throws(() => assertReleaseVersion(value));
  for (const value of ['2.8.9', '2.8.8']) assert.throws(() => assertReleaseVersion(value, '2.8.9'));
  assert.equal(baselineVersion('2.8.9'), '2.8.8'); assert.equal(baselineVersion('3.0.0'), '2.0.0');
});
const signing = { FORK_MAC_CERT_FILE: '/cert', FORK_MAC_CERT_PASSWORD: 'synthetic',
  FORK_MAC_IDENTITY: 'Developer ID Application: Test (TESTTEAM01)', FORK_APPLE_TEAM_ID: 'TESTTEAM01',
  FORK_NOTARY_KEY_FILE: '/key', FORK_NOTARY_KEY_ID: 'id', FORK_NOTARY_ISSUER: 'issuer',
  FORK_WIN_CERT_FILE: 'C:\\cert', FORK_WIN_CERT_PASSWORD: 'synthetic', FORK_WIN_PUBLISHER: 'Test' };
for (const platform of ['darwin', 'win32']) test(`signing fails closed for missing/disabled credentials (${platform})`, () => {
  assertSigning(platform, signing, false);
  assert.throws(() => assertSigning(platform, {}, false), /missing/);
  assert.throws(() => assertSigning(platform, { ...signing, NATIVELY_SKIP_NOTARIZE: '1' }, false), /forbids/);
  assert.throws(() => assertSigning(platform, { ...signing, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, false), /disabled/);
});
test('upstream identity/default settings cannot authorize fork signing', () => {
  assert.throws(() => assertSigning('darwin', { APPLE_TEAM_ID: 'UPSTREAM01', APPLE_KEYCHAIN_PROFILE: 'natively-notary' }, false));
  assert.throws(() => assertSigning('darwin', { ...signing, FORK_APPLE_TEAM_ID: 'OTHERTEAM1' }, false), /identity/);
});
for (const platform of ['darwin', 'win32']) test(`signed config preserves hooks and forces actual signing (${platform})`, () => {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, 'electron-builder.fork-signed.cjs'), 'utf8');
  const env = { ...signing };
  vm.runInNewContext(source, { module, process: { platform, env }, require: name => {
    if (name === './electron-builder.public.cjs') return publicConfig;
    if (name.includes('fork-policy')) return { assertSigning: (p, e) => assertSigning(p, e, false) };
    if (name.includes('afterAllArtifactBuild')) return () => {};
    throw new Error('Unexpected import');
  } });
  const config = module.exports;
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.beforePack, publicConfig.beforePack);
  assert.equal(config.afterPack, publicConfig.afterPack);
  if (platform === 'darwin') {
    assert.equal(config.extraMetadata.nativelySigned, true);
    assert.equal(env.APPLE_TEAM_ID, signing.FORK_APPLE_TEAM_ID);
    assert.equal(config.mac.hardenedRuntime, true);
  } else {
    assert.equal(config.extraMetadata.nativelySigned, false);
    assert.equal(config.win.verifyUpdateCodeSignature, true);
    assert.equal(config.win.signtoolOptions.publisherName, signing.FORK_WIN_PUBLISHER);
  }
});
test('trusted manual main commit and owner authorization are required', () => {
  const env = { GITHUB_REPOSITORY: `${release.owner}/${release.repo}`, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), FORK_DISTRIBUTION_AUTHORIZED: 'true' };
  assertContext(env, '2.8.9');
  for (const change of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/untrusted' }, { GITHUB_REPOSITORY: 'upstream/repo' }, { FORK_DISTRIBUTION_AUTHORIZED: '' }]) assert.throws(() => assertContext({ ...env, ...change }, '2.8.9'));
});
test('updater manifest requires confined payload paths, hashes and sizes', () => {
  const manifest = { version: '2.8.9', files: [{ url: 'Zatively-2.8.9.zip', sha512: 'hash', size: 1 }] };
  assert.throws(() => manifestFiles({ ...manifest, files: [{ ...manifest.files[0], url: 'Natively-2.8.9.zip' }] }, '2.8.9'), /Unsafe/);
  assert.equal(manifestFiles(manifest, '2.8.9').length, 1);
  for (const url of ['../payload.zip', 'C:\\payload.zip', 'https://evil.test/file.zip', 'nested/file.zip']) assert.throws(() => manifestFiles({ ...manifest, files: [{ ...manifest.files[0], url }] }, '2.8.9'));
  assert.throws(() => manifestFiles({ ...manifest, version: '2.8.8' }, '2.8.9'));
});
test('loopback server exposes only explicitly owned artifact names', () => {
  const allowed = new Set(['latest.yml', 'Natively.exe']);
  assert.equal(feedFile('/latest.yml?cache=1', allowed), 'latest.yml');
  for (const url of ['/unknown', '/%2E%2E%2Fsecret', '/C:%5Csecret', '/folder/Natively.exe']) assert.equal(feedFile(url, allowed), null);
});

test('upgrade observation reads the intercepted main module without reloading it', () => {
  for (const file of ['local-security-bootstrap.cjs', 'upgrade-security-bootstrap.cjs']) {
    const source = fs.readFileSync(path.join(root, 'scripts/audit', file), 'utf8');
    assert.doesNotMatch(source, /require\(entryFilename\)/);
    assert.match(source, /entryModule/);
  }
  const verifier = fs.readFileSync(path.join(root, 'scripts/audit/verify-packaged-e2e.mjs'), 'utf8');
  assert.match(verifier, /entryModule: module/);
});

test('upgrade networking accepts actual updater request options only on owned loopback ports', () => {
  const { ownedLoopbackRequest } = require('../audit/local-security-bootstrap.cjs');
  const ports = new Set([12345]);
  assert.equal(ownedLoopbackRequest('http://127.0.0.1:12345/latest.yml', ports), true);
  assert.equal(ownedLoopbackRequest({ protocol: 'http:', hostname: '127.0.0.1', port: 12345, path: '/latest.yml' }, ports), true);
  for (const url of ['https://127.0.0.1:12345/', 'http://127.0.0.1:12346/', 'http://example.com:12345/', null, {}])
    assert.equal(ownedLoopbackRequest(url, ports), false);
});
test('protected workflow has both platforms and a separate write-only publication job', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.jobs.build.environment, 'fork-release');
  assert.equal(workflow.jobs.build.strategy['fail-fast'], false);
  assert.deepEqual(workflow.jobs.build.strategy.matrix.include.map(item => item.platform), ['darwin', 'win32']);
  assert.equal(workflow.jobs.publish.needs, 'build');
  assert.equal(workflow.jobs.publish.permissions.contents, 'write');
  assert.equal(workflow.jobs.publish.environment, 'fork-release');
  for (const job of Object.values(workflow.jobs)) {
    const checkout = job.steps.find(step => step.uses === 'actions/checkout@v4');
    assert.equal(checkout.with.submodules, false); assert.equal(checkout.with.ref, '${{ github.sha }}');
  }
  assert.doesNotMatch(workflowSource, /dist:signed|upload-release\.mjs|schedule:|submodules: recursive/);
  for (const { run } of workflow.jobs.build.steps) if (run?.startsWith('node -e "')) new vm.Script(run.slice(9, -1));
});

async function receipts(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-release-tests-')); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const commit = 'a'.repeat(40), version = '2.8.9';
  for (const platform of ['darwin', 'win32']) {
    const dir = path.join(base, platform); fs.mkdirSync(dir);
    const names = platform === 'darwin' ? ['Natively.zip', 'Natively.dmg', 'Natively.zip.blockmap', 'latest-mac.yml'] : ['Natively.exe', 'Natively.exe.blockmap', 'latest.yml'];
    const artifacts = [];
    for (const name of names) { const full = path.join(dir, name); fs.writeFileSync(full, name); artifacts.push({ name, size: fs.statSync(full).size, sha256: await hash(full) }); }
    const report = { status: 0, version, commit, platform, arch: platform === 'darwin' ? 'arm64' : 'x64', artifacts };
    fs.writeFileSync(path.join(dir, 'artifacts.json'), JSON.stringify(report));
    fs.writeFileSync(path.join(dir, 'upgrade.json'), JSON.stringify({ ...report, to: version, targetArtifacts: artifacts,
      relaunch: { status: 0, cleanQuit: true, result: { themeMode: 'dark' } } }));
  }
  return { base, version, commit };
}
test('publication requires both accepted platforms and unchanged artifact bytes', async t => {
  const f = await receipts(t);
  assert.equal((await acceptedArtifacts(f.base, f.version, f.commit)).length, 7);
  fs.writeFileSync(path.join(f.base, 'win32', 'Natively.exe'), 'tampered');
  await assert.rejects(acceptedArtifacts(f.base, f.version, f.commit), /changed/);
});
test('incomplete upgrade acceptance and wrong source commit cannot publish', async t => {
  const f = await receipts(t);
  await assert.rejects(acceptedArtifacts(f.base, f.version, 'b'.repeat(40)), /Incomplete/);
  const file = path.join(f.base, 'darwin', 'upgrade.json');
  const upgrade = JSON.parse(fs.readFileSync(file)); upgrade.status = 2; fs.writeFileSync(file, JSON.stringify(upgrade));
  await assert.rejects(acceptedArtifacts(f.base, f.version, f.commit), /Incomplete/);
});
test('publisher creates draft, checks uploaded hashes, then publishes; never overwrites', async t => {
  const f = await receipts(t); const saved = { ...process.env };
  Object.assign(process.env, { GITHUB_REPOSITORY: `${release.owner}/${release.repo}`, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: f.commit, FORK_DISTRIBUTION_AUTHORIZED: 'true', FORK_RELEASE_VERSION: f.version, GITHUB_TOKEN: 'synthetic-test-token' });
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  const assets = await acceptedArtifacts(f.base, f.version, f.commit); const requests = [];
  const response = (status, value) => ({ status, ok: status >= 200 && status < 300, json: async () => value });
  const api = async (url, options = {}) => {
    requests.push({ url, method: options.method, body: options.body });
    if (url.endsWith(`/repos/${release.owner}/${release.repo}`)) return response(200, { private: false });
    if (/\/tags\//.test(url)) return response(404);
    if (url.includes('?per_page=')) return response(200, []);
    if (url.endsWith('/git/refs') && options.method === 'POST') {
      assert.equal(JSON.parse(options.body).sha, f.commit); return response(201, { object: { sha: f.commit } });
    }
    if (options.method === 'POST' && url.endsWith('/releases')) { assert.equal(JSON.parse(options.body).draft, true); return response(201, { id: 123, draft: true, assets: [] }); }
    if (url.includes('uploads.github.com')) {
      const file = assets.find(asset => new URL(url).searchParams.get('name') === asset.name);
      options.body.destroy(); return response(201, { state: 'uploaded', size: file.size, digest: `sha256:${file.sha256}` });
    }
    if (options.method === 'PATCH') return response(200, { draft: false });
    throw new Error('Unexpected request');
  };
  await publish(f.base, api); assert.equal(requests.at(-1).method, 'PATCH');
  assert.ok(requests.every(request => !request.url.includes('Natively-AI-assistant')));
  const beforeFailure = requests.length;
  await assert.rejects(publish(f.base, async (url, options = {}) => {
    if (url.includes('uploads.github.com')) {
      options.body.destroy();
      return response(201, { state: 'uploaded', size: assets[0].size, digest: 'sha256:unconfirmed' });
    }
    return api(url, options);
  }), /integrity unconfirmed/);
  assert.ok(requests.slice(beforeFailure).every(request => request.method !== 'PATCH'));
  await assert.rejects(publish(f.base, async () => response(200, { private: true })), /not publicly readable/);
  await assert.rejects(publish(f.base, async url => url.endsWith(`/${release.repo}`) ? response(200, { private: false }) : response(200, {})), /already exists/);
});
