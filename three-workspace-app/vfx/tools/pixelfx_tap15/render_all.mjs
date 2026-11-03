// Render every pixelfx effect in plan.json: transparent sheet + JSON + GIF preview, one folder per key.
// Usage: node render_all.mjs <pixelfx-checkout> <work-dir>   → <work-dir>/render/<key>/
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
if (process.argv.length < 4) throw new Error('usage: node render_all.mjs <pixelfx-checkout> <work-dir>');
const pixelfx = path.resolve(process.argv[2]);
const plan = JSON.parse(readFileSync(path.join(here, 'plan.json'), 'utf8'));
const out = path.join(path.resolve(process.argv[3]), 'render');
rmSync(out, { recursive: true, force: true });
for (const fx of plan.effects) {
  const tmp = path.join(out, '_tmp');
  rmSync(tmp, { recursive: true, force: true });
  const args = ['tools/render.mjs', fx.src, '--sheet', '--gif', '--scale', '3', '--bg', 'dark', '--no-actor', '--seed', '15', '--out', tmp];
  if (fx.palette) args.push('--opts', JSON.stringify({ palette: plan.palettes[fx.palette] }));
  execFileSync(process.execPath, args, { cwd: pixelfx, stdio: ['ignore', 'pipe', 'inherit'] });
  const [cat, name] = fx.src.split('/');
  const from = path.join(tmp, cat, name);
  const dest = path.join(out, fx.key);
  mkdirSync(dest, { recursive: true });
  for (const file of readdirSync(from)) {
    const ext = path.extname(file);
    const target = file === 'anim.gif' ? 'preview.gif' : file === 'contact.png' ? 'contact.png' : 'pixelfx' + ext;
    renameSync(path.join(from, file), path.join(dest, target));
  }
  rmSync(tmp, { recursive: true, force: true });
  const meta = JSON.parse(readFileSync(path.join(dest, 'pixelfx.json'), 'utf8')).meta.pixelfx;
  console.log(`${fx.key.padEnd(26)} ${fx.src.padEnd(22)} ${meta.frames}f ${meta.fps}fps loop=${meta.loop} ${meta.frameSize.join('x')}`);
}
