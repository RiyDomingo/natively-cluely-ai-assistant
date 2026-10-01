import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createUpdateCheckScheduler, UPDATE_STARTUP_DELAY_MS, UPDATE_INTERVAL_MS } = require('../../dist-electron/electron/update/updateCheckScheduler.js');

function timers() {
  const callbacks = new Map(); const delays = []; let next = 0;
  return { callbacks, delays,
    setTimeout(fn, delay) { delays.push(['startup', delay]); callbacks.set(++next, fn); return next; },
    setInterval(fn, delay) { delays.push(['daily', delay]); callbacks.set(++next, fn); return next; },
    clearTimeout(id) { callbacks.delete(id); }, clearInterval(id) { callbacks.delete(id); },
  };
}
test('packaged scheduling checks at 10 seconds and every 24 hours', async () => {
  const clock = timers(); let calls = 0;
  const scheduler = createUpdateCheckScheduler({ packaged: true, timers: clock, check: async () => { calls++; }, onError: assert.fail });
  assert.deepEqual(clock.delays, [['startup', UPDATE_STARTUP_DELAY_MS], ['daily', UPDATE_INTERVAL_MS]]);
  clock.callbacks.get(1)(); await scheduler.check();
  clock.callbacks.get(2)(); await scheduler.check();
  assert.equal(calls, 2); scheduler.stop(); assert.equal(clock.callbacks.size, 0);
  await scheduler.check(); assert.equal(calls, 2);
});
test('development does not schedule but retains manual checks', async () => {
  const clock = timers(); let calls = 0;
  const scheduler = createUpdateCheckScheduler({ packaged: false, timers: clock, check: async () => { calls++; }, onError: assert.fail });
  assert.equal(clock.callbacks.size, 0); await scheduler.check(); assert.equal(calls, 1); scheduler.stop();
});
test('overlapping checks share one flight, including synchronous startup work', async () => {
  let release, calls = 0;
  const scheduler = createUpdateCheckScheduler({ packaged: false, check: () => { calls++; return new Promise(resolve => { release = resolve; }); }, onError: assert.fail });
  const first = scheduler.check(), second = scheduler.check(); assert.equal(first, second);
  await Promise.resolve(); assert.equal(calls, 1); release(); await first; scheduler.stop();
});
test('offline/synchronous errors are nonfatal and later checks retry', async () => {
  const errors = []; let calls = 0;
  const scheduler = createUpdateCheckScheduler({ packaged: false, check: async () => { calls++; throw new Error('offline'); }, onError: error => errors.push(error.message) });
  await scheduler.check(); await scheduler.check(); assert.equal(calls, 2); assert.deepEqual(errors, ['offline', 'offline']); scheduler.stop();
});
test('integration preserves user-controlled downloads and stops on quit', () => {
  const main = fs.readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  assert.match(main, /autoUpdater\.autoDownload = false/);
  assert.match(main, /packaged: app\.isPackaged/);
  assert.match(main, /app\.once\('before-quit', \(\) => this\.updateCheckScheduler\?\.stop\(\)\)/);
  assert.match(main, /autoUpdater\.allowDowngrade = false/);
  assert.match(main, /await this\.updateCheckScheduler\?\.check\(\)/);
});
