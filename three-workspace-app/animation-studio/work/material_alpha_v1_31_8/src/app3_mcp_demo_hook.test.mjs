import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
// Called by the existing App3 suite after Builder/Studio gates. A child test
// process owns the browser/server; remove Node's inherited test-child sentinel.
test('E5 default real browser demo executes without skips', { timeout: 660000 }, () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      fileURLToPath(new URL('./app3_mcp_demo.test.mjs', import.meta.url)),
    ],
    { env, encoding: 'utf8', timeout: 640000, maxBuffer: 8 * 1024 * 1024 },
  );
  const unit = spawnSync(
    process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    ['-m', 'unittest', 'agent.app3_mcp_demo_test'],
    { cwd: new URL('../../../../', import.meta.url), encoding: 'utf8', timeout: 30000, env },
  );
  assert.equal(unit.status, 0, unit.stdout + unit.stderr);
  assert.match(unit.stderr, /Ran 2 tests/);
  console.log(result.stdout);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /# pass 1\b/);
  assert.match(result.stdout, /# skipped 0\b/);
});
