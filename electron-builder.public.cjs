const base = require('./package.json').build;
const release = require('./release.config.json');
const identity = require('./app.identity.json');

// Default fork/public packaging. Explicit upstream signed configuration is unchanged.
module.exports = {
  ...base,
  appId: identity.appId,
  productName: identity.name,
  mac: { ...base.mac, icon: identity.macIcon },
  win: { ...base.win, icon: identity.windowsIcon },
  publish: [{ provider: 'github', owner: release.owner, repo: release.repo, channel: release.channel, private: false }],
  // The source manifest may describe an upstream signed build. Public/ad-hoc
  // packaging must explicitly remove that capability; only fork-signed opts in.
  extraMetadata: { ...base.extraMetadata, name: identity.packageName, productName: identity.name, appIdentity: identity, forkRelease: release, nativelySigned: false },
};
