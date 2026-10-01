// Development-only F-117 regression: test bridge absent without opt-in,
// present with opt-in, but rejecting production channels. For isolated,
// offline packaged-mode verification use H-001-local-probe.mjs instead.
import { _electron as electron } from '@playwright/test';

async function probe(envExtra) {
  const app = await electron.launch({
    args: ['dist-electron/electron/main.js'],
    env: { ...process.env, NODE_ENV: 'production', NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', ...envExtra },
    timeout: 60_000,
  });
  await app.firstWindow({ timeout: 30_000 }).catch(() => null);
  await new Promise((r) => setTimeout(r, 2_500));
  let res = { type: 'no-bridge-window' };
  for (const w of app.windows()) {
    try {
      const out = await w.evaluate(async () => {
        const fn = window.electronAPI?.e2eInvoke;
        if (typeof fn !== 'function') return { type: typeof fn };
        try {
          const v = await fn('get-meeting-active');
          return { type: 'function', productionInvoke: true, value: v };
        } catch (e) {
          return { type: 'function', productionInvoke: false, error: String(e).slice(0, 100) };
        }
      });
      res = out; break;
    } catch { /* navigating */ }
  }
  await app.close();
  return res;
}

const closed = await probe({ NATIVELY_E2E: '0' });
console.log('[F-117] without NATIVELY_E2E:', JSON.stringify(closed));
if (closed.type === 'no-bridge-window') {
  console.error('[F-117] Inconclusive: no bridge window.');
  process.exit(2);
}
if (closed.type === 'function') {
  console.error('[F-117] FAIL: e2eInvoke exposed without the E2E env' +
    (closed.productionInvoke ? ' and it reaches production channels' : '') + ' (F-117 reproduced).');
  process.exit(1);
}

const open = await probe({ NATIVELY_E2E: '1' });
console.log('[F-117] with NATIVELY_E2E=1:', JSON.stringify(open));
if (open.type !== 'function') {
  console.error('[F-117] FAIL: gating broke the E2E surface — probes need e2eInvoke under NATIVELY_E2E=1.');
  process.exit(1);
}
if (open.productionInvoke || !open.error?.includes('E2E channel not allowed')) {
  console.error('[F-117] FAIL: development test bridge did not reject the production channel.');
  process.exit(1);
}
console.log('[F-117] PASS: development opt-in preserved; production channels rejected.');
process.exit(0);
