// External, isolated restart smoke only; no application API is added.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
if (process.versions.electron && process.type === 'browser') {
  const compile = Module.prototype._compile;
  Module.prototype._compile = function (content, filename) {
    if (path.resolve(filename) === path.resolve(process.env.NATIVELY_SECURITY_MAIN)) {
      Module.prototype._compile = compile;
      const isolation = require('./local-security-bootstrap.cjs');
      const { app, BrowserWindow, systemPreferences } = require('electron/main');
      const profile = process.env.NATIVELY_SECURITY_PROFILE;
      const counter = path.join(profile, 'restart-count.json');
      isolation.installHarness(filename, { entryModule: this, keepAlive: true,
        onReady(result) {
          (async () => {
            const enabled = process.env.NATIVELY_E2E === '1';
            if (result.packaged || !result.visible || result.bridge !== (enabled ? 'function' : 'undefined')
              || enabled && (!result.e2eReadSucceeded || !result.productionRejected || !result.namedProductionReadSucceeded)) {
              throw new Error('Unexpected development smoke policy/window');
            }
            const count = fs.existsSync(counter) ? JSON.parse(fs.readFileSync(counter, 'utf8')) + 1 : 1;
            fs.writeFileSync(counter, JSON.stringify(count));
            fs.copyFileSync(path.join(profile, 'launcher.png'), path.join(profile, `launcher-${count}.png`));
            console.log('[DEV-RESTART-READY] ' + JSON.stringify({ count, visible: result.visible, bridge: result.bridge,
              productionRejected: result.productionRejected, microphone: systemPreferences.getMediaAccessStatus('microphone') }));
            if (count === 1) {
              const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('window=launcher'));
              await win.webContents.executeJavaScript('window.electronAPI.restartApp()');
            } else if (count === 2) app.quit();
            else throw new Error('Unexpected restart loop');
          })().catch(error => { console.log('[SECURITY-PROBE-ERROR] ' + error.message); app.quit(); });
        },
      });
    }
    return compile.call(this, content, filename);
  };
}
