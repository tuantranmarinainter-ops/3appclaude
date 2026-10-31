// Node-only test resolver: use the already-vendored browser dependencies, no install.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const vendor = new URL('../../../vendor/', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier === 'three')
    return { url: new URL('three/build/three.module.js', vendor).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/'))
    return {
      url: new URL('three/examples/jsm/' + specifier.slice(13), vendor).href,
      shortCircuit: true,
    };
  if (specifier === '../vendor/tween_easing.js')
    return { url: new URL('tween_easing.js', vendor).href, shortCircuit: true };
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith('.'))
      for (const suffix of ['.ts', '/index.ts']) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
      }
    throw error;
  }
}
