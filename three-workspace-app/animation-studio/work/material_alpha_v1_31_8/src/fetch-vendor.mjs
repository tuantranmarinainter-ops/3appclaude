import fs from 'node:fs/promises';import path from 'node:path';
const root=new URL('../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const base='https://cdn.jsdelivr.net/npm/three@0.186.1/';
const seen=new Set();async function get(p){if(seen.has(p))return;seen.add(p);const res=await fetch(base+p);if(!res.ok)throw Error(p+': '+res.status);const source=await res.text();const out=path.join(root,'vendor/three',p);await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,source);const imports=[...source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)].map(m=>m[1]).filter(s=>s==='three'||s.startsWith('.'));await Promise.all(imports.map(s=>get(s==='three'?'build/three.module.js':path.posix.normalize(path.posix.join(path.posix.dirname(p),s)))));}
await Promise.all(['build/three.module.js','examples/jsm/controls/OrbitControls.js','examples/jsm/controls/TransformControls.js','examples/jsm/loaders/FBXLoader.js','examples/jsm/loaders/GLTFLoader.js','examples/jsm/exporters/GLTFExporter.js','examples/jsm/utils/SkeletonUtils.js'].map(get));console.log('Pinned vendor modules:',seen.size);

