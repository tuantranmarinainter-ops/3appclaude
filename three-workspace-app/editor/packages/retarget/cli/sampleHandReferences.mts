// Run once against the user's V9.12 reference; only sampled quaternion data is committed.
import { readFileSync, writeFileSync } from 'node:fs'
import { AnimationMixer, Quaternion } from 'three'
import { loadAsset } from './loadAsset.ts'

const html = readFileSync(process.argv[2]!, 'utf8')
const poses: Record<string, Record<string, number[]>> = {}
for (const kind of ['natural', 'fist']) {
  const encoded = html.match(new RegExp(`<script[^>]*id="embedded-${kind}-fbx"[^>]*>([\\s\\S]*?)</script>`))?.[1]
  if (!encoded) throw Error(`Missing ${kind} reference`)
  const root = await loadAsset(Buffer.from(encoded.replace(/\s/g, ''), 'base64'), 'fbx', { skeletonOnly: true })
  const fingers: Array<{ name: string; rest: Quaternion; bone: typeof root }> = []
  root.traverse(bone => {
    const name = bone.name.replace(/^.*[:|]/, '').replace(/^mixamorig\d*/i, '').toLowerCase()
    if (/^(left|right)hand(thumb|index|middle|ring|pinky)[1-4]$/.test(name)) fingers.push({ name, rest: bone.quaternion.clone(), bone })
  })
  const clip = root.animations[0], mixer = new AnimationMixer(root)
  let chosen = 0
  if (clip) {
    mixer.clipAction(clip).play()
    chosen = clip.duration / 2
    if (kind === 'fist') {
      let best = -1
      for (let k = 0; k <= 24; k++) {
        mixer.setTime(clip.duration * k / 24)
        const score = fingers.reduce((sum, { rest, bone }) => sum + rest.angleTo(bone.quaternion), 0)
        if (score > best) { best = score; chosen = clip.duration * k / 24 }
      }
    }
    mixer.setTime(chosen)
  }
  if (fingers.length < 30) throw Error(`Incomplete ${kind} fingers: ${fingers.length}`)
  poses[kind] = Object.fromEntries(fingers.map(({ name, rest, bone }) => [name, rest.invert().multiply(bone.quaternion).normalize().toArray().map(n => Number(n.toFixed(9)))]))
  mixer.stopAllAction(); mixer.uncacheRoot(root)
}
writeFileSync(new URL('../src/handReferencePoses.ts', import.meta.url), `// Finger deltas sampled from V9.12 embedded Natural/Fist FBX (same selection as sampleReferencePose).\nexport const HAND_REFERENCE_POSES: Record<string, Record<string, number[]>> = ${JSON.stringify(poses, null, 2)}\n`)
