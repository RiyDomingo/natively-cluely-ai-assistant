import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../../.github/workflows/packaged-e2e-security.yml', import.meta.url), 'utf8');
const workflow = require('yaml').parse(source); // Existing build dependency.
const job = workflow.jobs['packaged-e2e'];

test('packaged verification blocks both host-native CI jobs', () => {
  assert.deepEqual(job.strategy.matrix.os, ['macos-latest', 'windows-latest']);
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job['continue-on-error'], undefined);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(job.steps.find(step => step.uses === 'actions/checkout@v4').with.submodules, false);
  assert.doesNotMatch(source, /secrets\.|submodule update|audit fix|--publish always/);
});

test('CI uses the packaging wrapper without publishing or bypassing hooks', () => {
  const command = job.steps.find(step => step.name === 'Package host-native directory (never publish)').run;
  assert.match(command, /scripts\/package-app\.js/);
  assert.match(command, /'--dir'/);
  assert.match(command, /'--publish','never'/);
  assert.match(command, /'--'\+process\.arch/);
  assert.match(command, /'--mac':'--win'/);
  assert.doesNotMatch(command, /ignore-scripts|beforePack|afterPack/);
  assert.ok(job.steps.some(step => step.run === 'npm run typecheck:electron'));
  assert.ok(job.steps.some(step => step.run === 'npm run typecheck:ts7'));
});

test('CI verifies real ASAR packages and retains incomplete evidence', () => {
  const command = job.steps.find(step => step.name === 'Verify unchanged packaged application').run;
  assert.match(command, /verify-packaged-e2e\.mjs/);
  assert.match(command, /app\.asar/);
  assert.match(command, /apps\.length!==1/);
  const upload = job.steps.find(step => step.uses === 'actions/upload-artifact@v4');
  assert.equal(upload.if, 'always()');
  const incomplete = job.steps.find(step => step.name?.startsWith('Record incomplete'));
  assert.equal(incomplete.if, 'always()');
  assert.match(incomplete.run, /status:2/);
  assert.doesNotMatch(source, /verify:packaged-assets/);
});

test('every inline cross-platform Node command is valid JavaScript', () => {
  for (const { run } of job.steps) {
    if (!run?.startsWith('node -e "')) continue;
    assert.ok(run.endsWith('"'));
    new vm.Script(run.slice('node -e "'.length, -1));
  }
});
