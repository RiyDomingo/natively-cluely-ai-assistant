import identity from '../../app.identity.json';
export const APP_IDENTITY = Object.freeze(identity);

// Only our product's payloads are accepted from the existing fork feed.
export function isOwnUpdate(info: { files?: { url: string }[] } | null | undefined): boolean {
  return Array.isArray(info?.files) && info.files.length > 0 && info.files.every(file => {
    try {
      const name = decodeURIComponent(new URL(file.url, 'https://update.invalid/').pathname.split('/').pop() || '');
      return name.startsWith(`${identity.name}-`) && /^[A-Za-z0-9._-]+$/.test(name)
        && !name.includes('..') && /\.(zip|exe|dmg|AppImage)$/.test(name);
    } catch { return false; }
  });
}
