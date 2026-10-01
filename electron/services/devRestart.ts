// Lifecycle coordination only. This must never authorize test or paid APIs.
if (process.versions.electron && process.type === 'browser') {
  process.on('message', message => {
    if (!process.connected || process.env.NATIVELY_DEV_SUPERVISOR !== '1') return;
    if ((message as { type?: string })?.type === 'natively-dev-quit') {
      // Lazy import keeps this module straightforward to unit test.
      const { app } = require('electron');
      if (!app.isPackaged) app.quit();
    }
  });
}
export async function restartApplication(
  app: { isPackaged: boolean; relaunch(): void; quit(): void },
  host: Pick<NodeJS.Process, 'connected' | 'send' | 'env'> = process,
): Promise<void> {
  if (app.isPackaged) { app.relaunch(); app.quit(); return; }
  if (host.env.NATIVELY_DEV_SUPERVISOR !== '1' || !host.connected || !host.send) {
    throw new Error('Development restart requires npm start. Quit this instance and run npm start.');
  }
  await new Promise<void>((resolve, reject) => {
    host.send!({ type: 'natively-dev-restart' }, error => error ? reject(error) : resolve());
  });
  app.quit();
}
