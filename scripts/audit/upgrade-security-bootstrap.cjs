const Module = require('node:module');
const path = require('node:path');
const isolation = require('./local-security-bootstrap.cjs');

function installHarness(entryFilename = process.env.NATIVELY_SECURITY_MAIN, options = {}) {
  const port = Number(process.env.FORK_QA_PORT);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Owned loopback feed required');
  const metadata = isolation.installHarness(entryFilename, { keepAlive: true, loopbackPort: port, entryModule: options.entryModule });
  const { app, BrowserWindow } = require('electron/main');
  // Load the artifact's own dependency, never a workspace updater implementation.
  const { autoUpdater } = require(require.resolve('electron-updater', { paths: [app.getAppPath()] }));
  Object.defineProperty(autoUpdater.app, 'baseCachePath', { value: path.join(process.env.NATIVELY_SECURITY_PROFILE, 'updater-cache') });
  const setFeedURL = autoUpdater.setFeedURL.bind(autoUpdater);
  autoUpdater.setFeedURL = () => setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${port}/`, channel: 'latest' });
  let started = false;
  app.on('browser-window-created', (_event, win) => {
    win.webContents.on('did-finish-load', async () => {
      if (started || !win.webContents.getURL().includes('window=launcher')) return;
      started = true;
      try {
        // Prevent uncontrolled updater relaunch from opening the production
        // profile. The parent relaunches the updated package under isolation.
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.autoRunAppAfterInstall = false;
        autoUpdater.installDirectory = process.env.FORK_QA_INSTALL;
        await new Promise(resolve => setTimeout(resolve, 5_000));
        if (!BrowserWindow.getAllWindows().some(window => window.isVisible())) throw new Error('No visible baseline window');
        const AppState = options.entryModule?.exports?.AppState;
        if (!AppState) throw new Error('Main module exports not observed; refusing to reload application entry');
        const expected = process.env.FORK_QA_TARGET_VERSION;
        if (!AppState.isRealUpgrade(app.getVersion(), expected)) throw new Error('QA target is not a real upgrade');
        const result = await autoUpdater.checkForUpdates();
        if (result?.updateInfo?.version !== expected) throw new Error('Unexpected target version');
        await AppState.getInstance().downloadUpdate();
        if (AppState.getInstance().updateDownloadState !== 'downloaded') throw new Error('Application download did not complete');
        console.log('[UPGRADE-DOWNLOADED] ' + JSON.stringify({ from: app.getVersion(), to: expected }));
        // Real updater install. Silent/no-auto-run Windows install is confined
        // to the owned install directory; macOS uses its real Squirrel path.
        autoUpdater.quitAndInstall(true, false);
      } catch (error) {
        console.log('[SECURITY-PROBE-ERROR] ' + JSON.stringify({ message: error.message })); app.quit();
      }
    });
  });
  return metadata;
}

function armEntryHook() {
  const compile = Module.prototype._compile;
  Module.prototype._compile = function (content, filename) {
    if (path.resolve(filename) === path.resolve(process.env.NATIVELY_SECURITY_MAIN)) {
      Module.prototype._compile = compile; installHarness(filename, { entryModule: this });
    }
    return compile.call(this, content, filename);
  };
  return { armed: true };
}
module.exports = { installHarness, armEntryHook };
