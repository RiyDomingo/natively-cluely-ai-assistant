const signed = require('./electron-builder.fork-signed.cjs');
const { baselineVersion } = require('./scripts/release/fork-policy.cjs');
module.exports = {
  ...signed,
  directories: { ...signed.directories, output: 'release-baseline' },
  extraMetadata: { ...signed.extraMetadata, version: baselineVersion(require('./package.json').version) },
  // QA baseline is signed/notarized, but never published and needs no manual DMG.
  afterAllArtifactBuild: undefined,
};
