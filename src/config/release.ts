import config from '../../release.config.json';
import identity from '../../app.identity.json';

// Public build-time configuration. Never contains credentials or runtime overrides.
export const RELEASE_CONFIG = Object.freeze(config);
export const REPOSITORY_URL = `https://github.com/${config.owner}/${config.repo}`;
export const LATEST_RELEASE_URL = `https://github.com/${config.owner}/${config.repo}/releases/latest`;

export function releaseApiUrl(version: string): string {
  if (version === 'latest') return `https://api.github.com/repos/${config.owner}/${config.repo}/releases/latest`;
  const tag = version.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(tag)) throw new Error('Invalid stable release version');
  return `https://api.github.com/repos/${config.owner}/${config.repo}/releases/tags/v${tag}`;
}

export function macReleaseDownloadUrl(version: string, arch: string): string {
  const stable = version.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(stable) || arch !== 'arm64') return LATEST_RELEASE_URL;
  return `https://github.com/${config.owner}/${config.repo}/releases/download/v${stable}/${identity.name}-${stable}-arm64.dmg`;
}
