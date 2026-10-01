import { classifyMicStatus } from './micPermissionPolicy.mjs';

export async function readPermissions(api) {
  if (typeof api?.checkPermissions !== 'function') throw new Error('Permission controls are unavailable. Restart using npm start or the installed Natively app.');
  const result = await api.checkPermissions();
  const statuses = ['granted', 'denied', 'restricted', 'not-determined', 'unknown'];
  if (!result || typeof result.platform !== 'string' || !statuses.includes(result.microphone) || !statuses.includes(result.screen)) {
    throw new Error('Unable to read OS permission status. Restart the app and retry.');
  }
  return result;
}

export async function actOnMicrophone(api, platform, status) {
  const { remedy } = classifyMicStatus(platform, status);
  if (remedy === 'request') {
    if (typeof api?.requestMicPermission !== 'function') throw new Error('Microphone request is unavailable. Restart the app and retry.');
    await api.requestMicPermission(); // A false result is a denial, not a successful grant.
  } else if (remedy === 'settings') {
    if (typeof api?.openMicSettings !== 'function') throw new Error('Microphone settings controls are unavailable. Open your OS privacy settings manually.');
    const result = await api.openMicSettings();
    if (result?.ok !== true) throw new Error('Unable to open microphone settings. Open your OS privacy settings manually.');
  }
  return readPermissions(api);
}
