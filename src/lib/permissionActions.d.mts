type PermissionSnapshot = { microphone: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'; screen: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'; platform: string };
type PermissionAPI = { checkPermissions?: () => Promise<unknown>; requestMicPermission?: () => Promise<boolean>; openMicSettings?: () => Promise<unknown> };
export function readPermissions(api: PermissionAPI | undefined): Promise<PermissionSnapshot>;
export function actOnMicrophone(api: PermissionAPI | undefined, platform: string, status: string): Promise<PermissionSnapshot>;
