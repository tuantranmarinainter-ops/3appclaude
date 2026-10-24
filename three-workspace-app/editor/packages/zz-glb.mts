import { readFileSync } from 'node:fs'
import { decodeGlb } from './retarget/cli/glb.ts'
for (const f of process.argv.slice(2)) {
  const j: any = decodeGlb(readFileSync(f)).json
  console.log(f.split('/').slice(-3).join('/'), 'nodes', j.nodes.length, 'skins', j.skins?.map((s: any) => s.joints.length), 'meshes', j.meshes?.length, 'anims', j.animations?.map((a: any) => a.name).slice(-3), 'root', j.scenes[0].nodes.map((n: number) => j.nodes[n].name + JSON.stringify(j.nodes[n].rotation ?? '') + JSON.stringify(j.nodes[n].scale ?? '')))
}
