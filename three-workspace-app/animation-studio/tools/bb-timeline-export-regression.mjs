// Run with the existing shot_test_loader + tsx loader for vendor/TS imports.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { minecraft20BOBJ } from '../work/material_alpha_v1_31_8/src/minecraft20_export.js';
const { chromium } = createRequire(
  new URL('../../editor/apps/studio/package.json', import.meta.url),
)('playwright');
const [beforeHtml, evidence] = process.argv.slice(2);
if (!beforeHtml || !evidence)
  throw Error('Usage: node tools/bb-timeline-export-regression.mjs <before.html> <evidence-dir>');
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(readFileSync(beforeHtml));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1120 } });
  page.on('dialog', (d) => d.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.__studio?.ready);
  await page.evaluate(
    async (p) => {
      await window.__studio.loadProject(p);
      document.getElementById('includeSkin').checked = false;
      document.getElementById('exportProfile').value = 'same';
    },
    JSON.parse(readFileSync(path.join(evidence, 'legacy-project.json'), 'utf8')),
  );
  const bytes = await page.evaluate(async () =>
    Array.from(new Uint8Array((await window.__studio.buildGLB()).data)),
  );
  writeFileSync(path.join(evidence, 'before.glb'), Buffer.from(bytes));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = value;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`;
      this.onloadend?.();
    });
  }
};
const hashes = {},
  outputs = {};
for (const name of ['before', 'candidate-legacy', 'candidate-metadata']) {
  const output = Buffer.from(
    await minecraft20BOBJ(new Uint8Array(readFileSync(path.join(evidence, name + '.glb')))),
  );
  writeFileSync(path.join(evidence, name + '.bobj'), output);
  outputs[name] = output;
  hashes[name] = {
    bytes: output.length,
    sha256: createHash('sha256').update(output).digest('hex'),
  };
}
assert.deepEqual(outputs['candidate-legacy'], outputs.before, 'Legacy Minecraft20 bytes changed');
assert.deepEqual(
  outputs['candidate-metadata'],
  outputs.before,
  'Preview metadata changed Minecraft20 bytes',
);
const result = {
  sample: 'three-workspace-app/builtin-assets/animation-studio/sample.fbx',
  fixtureSha256: createHash('sha256')
    .update(
      readFileSync(new URL('../../builtin-assets/animation-studio/sample.fbx', import.meta.url)),
    )
    .digest('hex'),
  equal: true,
  hashes,
};
writeFileSync(path.join(evidence, 'export-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
