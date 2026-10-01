// F-117/F-001 wiring pin. Behavioral and bundled-preload coverage lives in
// E2eTestPolicy.test.mjs; this checks the source uses that shared contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'preload.ts'), 'utf8');

test('e2eInvoke uses main-owned authorization through the shared policy', () => {
  assert.match(preload, /createE2eTestBridge\(\s*ipcRenderer\.sendSync\(E2E_TEST_POLICY_CHANNEL\)/);
  assert.match(preload, /\.\.\.e2eTestBridge/);
  assert.doesNotMatch(preload, /process\.env\.NATIVELY_E2E/);
});
