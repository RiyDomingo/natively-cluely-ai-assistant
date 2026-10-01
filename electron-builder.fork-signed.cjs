const base = require('./electron-builder.public.cjs');
const { assertSigning } = require('./scripts/release/fork-policy.cjs');

// Separate opt-in pipeline: never import upstream credential defaults.
assertSigning(process.platform, process.env);
const env = process.env;
if (process.platform === 'darwin') {
  env.NATIVELY_PRODUCTION_SIGN = '1';
  env.CSC_LINK = env.FORK_MAC_CERT_FILE;
  env.CSC_KEY_PASSWORD = env.FORK_MAC_CERT_PASSWORD;
  env.NATIVELY_SIGN_IDENTITY = env.FORK_MAC_IDENTITY;
  env.APPLE_TEAM_ID = env.FORK_APPLE_TEAM_ID;
  env.APPLE_API_KEY = env.FORK_NOTARY_KEY_FILE;
  env.APPLE_API_KEY_ID = env.FORK_NOTARY_KEY_ID;
  env.APPLE_API_ISSUER = env.FORK_NOTARY_ISSUER;
  delete env.APPLE_KEYCHAIN_PROFILE;
  delete env.APPLE_ID;
  delete env.APPLE_APP_SPECIFIC_PASSWORD;
}

module.exports = {
  ...base,
  forceCodeSigning: true,
  extraMetadata: { ...base.extraMetadata, ...(process.platform === 'darwin' ? { nativelySigned: true } : {}) },
  ...(process.platform === 'darwin' ? {
    afterSign: './scripts/notarize.js',
    afterAllArtifactBuild: require('./scripts/afterAllArtifactBuild.cjs'),
    mac: { ...base.mac, identity: env.FORK_MAC_IDENTITY, hardenedRuntime: true,
      entitlements: 'build/entitlements.mac.plist', entitlementsInherit: 'build/entitlements.mac.inherit.plist',
      notarize: false, target: [{ target: 'zip', arch: ['arm64'] }] },
  } : {
    win: { ...base.win, target: [{ target: 'nsis', arch: ['x64'] }], verifyUpdateCodeSignature: true,
      signtoolOptions: { certificateFile: env.FORK_WIN_CERT_FILE,
        certificatePassword: env.FORK_WIN_CERT_PASSWORD, publisherName: env.FORK_WIN_PUBLISHER } },
  }),
};
