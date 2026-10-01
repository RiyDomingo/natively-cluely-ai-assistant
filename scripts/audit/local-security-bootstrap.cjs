// Test harness only. Loaded before the application; never part of its runtime.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function ownedLoopbackRequest(input, ports) {
  try {
    const url = typeof input === 'string' || input instanceof URL ? input :
      input.url || input.href || `${input.protocol}//${input.hostname || input.host}${input.port ? `:${input.port}` : ''}${input.path || '/'}`;
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && ports.has(Number(parsed.port));
  } catch { return false; }
}

function installHarness(entryFilename = process.env.NATIVELY_SECURITY_MAIN, options = {}) {
  const { app, session, shell, ipcMain } = require('electron/main');
  // Observe registration independently of the renderer bridge. Do not invoke
  // mutation handlers or replace the application's authorization decision.
  const registeredTestChannels = new Set();
  const policyReplies = [];
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    const result = handle(channel, listener);
    if (channel.startsWith('__e2e__:')) registeredTestChannels.add(channel);
    return result;
  };
  const removeHandler = ipcMain.removeHandler.bind(ipcMain);
  ipcMain.removeHandler = channel => {
    registeredTestChannels.delete(channel);
    return removeHandler(channel);
  };
  const on = ipcMain.on.bind(ipcMain);
  ipcMain.on = (channel, listener) => on(channel, channel === 'e2e-test-policy'
    ? (event, ...args) => {
        // Electron's returnValue is write-only. Observe the assignment while
        // forwarding it unchanged to the real event, not a mocked reply.
        listener(new Proxy(event, {
          set(target, key, value) {
            if (key === 'returnValue') policyReplies.push(value);
            return Reflect.set(target, key, value, target);
          },
        }), ...args);
      }
    : listener);
  const profile = process.env.NATIVELY_SECURITY_PROFILE;
  if (!profile) throw new Error('An isolated security-test profile is required');
  if (process.env.NATIVELY_SECURITY_ARTIFACT === '1'
    && path.resolve(entryFilename) !== path.resolve(process.env.NATIVELY_SECURITY_MAIN)) {
    throw new Error('Security harness must precede the exact packaged entry');
  }
  fs.mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
  app.setPath('sessionData', path.join(profile, 'chromium'));
  // A copied app must not load developer credentials from the repository .env.
  const load = Module._load;
  Module._load = function (request, ...args) {
    if (request === 'dotenv') return { config: () => ({ parsed: {} }) };
    return load.call(this, request, ...args);
  };
  const denied = () => { throw new Error('External network disabled by local security harness'); };
  const ownedPorts = new Set(options.loopbackPort ? [Number(options.loopbackPort)] : []);
  const allowRequest = url => ownedLoopbackRequest(url, ownedPorts);
  global.fetch = async () => { denied(); };
  for (const protocol of ['node:http', 'node:https']) {
    const transport = require(protocol);
    for (const method of ['request', 'get']) {
      const original = transport[method];
      transport[method] = function (url, ...args) {
        if (!allowRequest(url)) denied();
        return original.call(this, url, ...args);
      };
    }
  }
  const net = require('node:net');
  if (options.loopbackPort) {
    const listen = net.Server.prototype.listen;
    net.Server.prototype.listen = function (...args) {
      this.once('listening', () => {
        const address = this.address();
        if (address?.address === '127.0.0.1') ownedPorts.add(address.port);
      });
      return listen.apply(this, args);
    };
  }
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const options = typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
    const host = options.host || 'localhost';
    const permitted = process.env.NATIVELY_SECURITY_ARTIFACT !== '1'
      && ['localhost', '127.0.0.1', '::1'].includes(host) && Number(options.port) === 5180;
    if (!permitted && !(host === '127.0.0.1' && ownedPorts.has(Number(options.port)))) denied();
    return connect.apply(this, args);
  };
  // Electron's native HTTP transport does not go through Node http or fetch.
  const electronNet = require('electron/main').net;
  const nativeRequest = electronNet.request.bind(electronNet);
  electronNet.request = (url, ...args) => {
    if (!allowRequest(url)) denied();
    const request = nativeRequest(url, ...args);
    request.on('redirect', (_status, _method, redirect) => { if (!allowRequest(redirect)) request.abort(); });
    return request;
  };
  electronNet.fetch = async () => { denied(); };
  shell.openExternal = async () => { denied(); };
  app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = /^(file:|data:|blob:|devtools:)/.test(details.url)
        || (Boolean(options.loopbackPort) && allowRequest(details.url))
        || (process.env.NATIVELY_SECURITY_ARTIFACT !== '1' && (
          /^https?:\/\/(localhost|127\.0\.0\.1):5180\//.test(details.url)
          || /^ws:\/\/(localhost|127\.0\.0\.1):5180\//.test(details.url)));
      callback({ cancel: !allowed });
    });
  });
  const metadata = {
    packaged: app.isPackaged, profile: app.getPath('userData'),
    appPath: app.getAppPath(), entryFilename,
    e2e: process.env.NATIVELY_E2E === '1', platform: process.platform, arch: process.arch,
  };
  console.log('[SECURITY-HARNESS] ' + JSON.stringify(metadata));
  // Only the external test process owns this IPC channel. It provides normal
  // shutdown on timeout without adding any production renderer capability.
  process.on('message', message => {
    if (message?.type === 'natively-security-quit') app.quit();
  });
  let completed = false;
  let ready = false;
  const timeout = setTimeout(() => {
    console.log('[SECURITY-TIMEOUT] No rendered application window completed');
    options.onFailure?.(new Error('Security readiness timed out'));
    app.quit();
  }, 45_000);
  app.on('browser-window-created', (_event, win) => {
    win.webContents.on('did-finish-load', async () => {
      if (completed) return;
      try {
        await new Promise(resolve => setTimeout(resolve, 2_000));
        if (completed || win.isDestroyed()) return;
        if (!win.webContents.getURL().includes('window=launcher')) return;
        let rendered;
        for (let attempt = 0; attempt < 60; attempt++) {
          rendered = await win.webContents.executeJavaScript(`({
            text: document.querySelector('#root')?.textContent?.trim() || '',
            bridge: typeof window.electronAPI,
            e2e: typeof window.electronAPI?.e2eInvoke
          })`);
          if (rendered.text.length >= 50 && rendered.bridge === 'object') break;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (rendered.text.length < 50 || rendered.bridge !== 'object') return;
        completed = true;
        // Read-only probes. No trial seeding, ingestion, deletion, or provider calls.
        const probe = process.env.NATIVELY_SECURITY_ARTIFACT === '1'
          ? { bridge: rendered.e2e }
          : await win.webContents.executeJavaScript(`(async () => {
          const fn = window.electronAPI?.e2eInvoke;
          if (typeof fn !== 'function') return { bridge: typeof fn };
          const audit = await fn('__e2e__:context-os-prompt-audit');
          let productionRejected = false;
          try { await fn('get-meeting-active'); }
          catch (error) { productionRejected = error.message.includes('E2E channel not allowed'); }
          const active = await window.electronAPI.getMeetingActive();
          return { bridge: typeof fn, e2eReadSucceeded: audit?.success === true,
            auditCount: audit?.audit?.length, productionRejected,
            namedProductionReadSucceeded: typeof active === 'boolean' };
        })()`);
        const result = {
          packaged: app.isPackaged, visible: win.isVisible(),
          renderedCharacters: rendered.text.length, ...probe,
          registeredTestChannels: [...registeredTestChannels].sort(),
          syntheticHandlerCaptured: typeof globalThis.__nativelyGeminiChatStream === 'function',
          policyReplies,
          appPath: app.getAppPath(), entryFilename,
          themeMode: options.entryModule?.exports?.AppState?.getInstance().themeManager.getMode(),
        };
        console.log('[SECURITY-RESULT] ' + JSON.stringify(result));
        await new Promise(resolve => setTimeout(resolve, 2_000));
        fs.writeFileSync(path.join(profile, 'launcher.png'), (await win.webContents.capturePage()).toPNG());
        clearTimeout(timeout);
        ready = true;
        options.onReady?.(result);
        if (!options.keepAlive) setTimeout(() => app.quit(), 500);
      } catch (error) {
        console.log('[SECURITY-PROBE-ERROR] ' + error.message);
        options.onFailure?.(error);
        clearTimeout(timeout);
        app.quit();
      }
    });
  });
  app.on('will-quit', () => {
    if (!ready) options.onFailure?.(new Error('Application quit before security readiness'));
    clearTimeout(timeout);
    console.log('[SECURITY-CLEAN-QUIT]');
  });
  return metadata;
}

function armEntryHook() {
  const compile = Module.prototype._compile;
  Module.prototype._compile = function (content, filename) {
    if (path.resolve(filename) === path.resolve(process.env.NATIVELY_SECURITY_MAIN)) {
      Module.prototype._compile = compile;
      installHarness(filename, { entryModule: this });
    }
    return compile.call(this, content, filename);
  };
  return { armed: true };
}

module.exports = { installHarness, armEntryHook, ownedLoopbackRequest };

if (process.versions.electron && process.type === 'browser'
  && process.env.NATIVELY_SECURITY_DEBUGGER !== '1') {
  if (process.env.NATIVELY_SECURITY_PRELOAD !== '1') installHarness();
  else {
    // NODE_OPTIONS preloads run before Electron installs its built-in module.
    // Install immediately before the real application main is compiled instead.
    armEntryHook();
  }
}
