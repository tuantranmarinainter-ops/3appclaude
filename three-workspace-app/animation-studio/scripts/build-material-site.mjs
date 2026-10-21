import fs from 'node:fs/promises';
await fs.mkdir('outputs',{recursive:true});
await import('../work/material_alpha_v1_31_8/src/build.mjs');
const html=await fs.readFile('outputs/Animation_Studio_v1_31_8.html','utf8');
const worker=await fs.readFile('work/material_alpha_v1_31_8/mcp_worker.js','utf8')+'\nexport default createWorker('+JSON.stringify(html)+');\n';
await fs.mkdir('worker',{recursive:true});await fs.writeFile('worker/index.js',worker);
await fs.mkdir('dist/server',{recursive:true});await fs.mkdir('dist/.openai',{recursive:true});
await fs.writeFile('dist/server/index.js',worker);await fs.copyFile('.openai/hosting.json','dist/.openai/hosting.json');
await fs.rm('dist/index.html',{force:true});console.log('Built Animation Studio 1.31.8 private test site worker.');
