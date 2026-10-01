// Run before any service captures app.getPath('userData') at module load.
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import identity from '../app.identity.json';

export function initializeAppIdentity(target = app, platform = process.platform) {
  const initialName = target.getName();
  const initialProfile = target.getPath('userData');
  const initialSession = target.getPath('sessionData');
  const defaultProfile = path.join(target.getPath('appData'), initialName);
  const same = (a: string, b: string) => platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  // Honor explicit CLI/external-harness profiles; never import the old profile.
  const profile = same(initialProfile, defaultProfile)
    ? path.join(target.getPath('appData'), identity.profileDirectory) : initialProfile;
  if (same(initialProfile, defaultProfile)) fs.mkdirSync(profile, { recursive: true });
  target.setName(identity.name);
  target.setPath('userData', profile);
  if (same(initialSession, initialProfile)) target.setPath('sessionData', profile);
  if (platform === 'win32') target.setAppUserModelId(identity.appId);
  return profile;
}

initializeAppIdentity();
