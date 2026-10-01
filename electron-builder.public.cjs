const base = require('./package.json').build;
const release = require('./release.config.json');

// Default fork/public packaging. Explicit upstream signed configuration is unchanged.
module.exports = {
  ...base,
  publish: [{ provider: 'github', owner: release.owner, repo: release.repo, channel: release.channel, private: false }],
  // The source manifest may describe an upstream signed build. Public/ad-hoc
  // packaging must explicitly remove that capability; only fork-signed opts in.
  extraMetadata: { ...base.extraMetadata, forkRelease: release, nativelySigned: false },
};
