#!/usr/bin/env node
// 生成三档压测草稿到 apps/studio/drafts/perf-stress-{s,m,l}.json。
// 素材 key 取自官方库（/v2/3d-assets），只写 S3 key，签名由宿主做。
// 用法：node scripts/perf/gen-stress-drafts.cjs
const fs = require('fs')
const path = require('path')

const CHARACTERS = [
  ['a3d_char_30ec53c93eae4173946b38639691ebe0', 'Female', '3d-builder/library/characters/a3d_char_30ec53c93eae4173946b38639691ebe0-d4ce3fb1.glb'],
  ['a3d_char_7d220ac359844c80a8faaf0e25478477', 'Man', '3d-builder/library/characters/a3d_char_7d220ac359844c80a8faaf0e25478477-74da5e96.glb'],
  ['a3d_char_de37873a79244fbe8a0660ea08d1b4ab', 'Youth', '3d-builder/library/characters/a3d_char_de37873a79244fbe8a0660ea08d1b4ab-b6ca36e2.glb'],
  ['a3d_char_461b4f4b76ae4b198f439fa4f6f743b6', 'Child', '3d-builder/library/characters/a3d_char_461b4f4b76ae4b198f439fa4f6f743b6-10f31d59.glb'],
]

// 按文件体积均匀取样的 40 个道具（3KB ~ 850KB）
const PROPS = [
  ['a3d_prop_ef23a48123fa4c798c05c54127be331c', 'Cubby Storage', '3d-builder/library/props/a3d_prop_ef23a48123fa4c798c05c54127be331c-222abd5e.glb'],
  ['a3d_prop_58b7154efc0c4c779bca4447f40f4313', 'Modern Zigzag Shelf', '3d-builder/library/props/a3d_prop_58b7154efc0c4c779bca4447f40f4313-cb7fc154.glb'],
  ['a3d_prop_a927659b25dc4342aa80ec35ab0811af', 'Modern Cube Wall Cubby', '3d-builder/library/props/a3d_prop_a927659b25dc4342aa80ec35ab0811af-296511b2.glb'],
  ['a3d_prop_f2fd432238fc4cf7a283c92f25fb8c9c', 'Door', '3d-builder/library/props/a3d_prop_f2fd432238fc4cf7a283c92f25fb8c9c-4c4bda98.glb'],
  ['a3d_prop_e6aa5cd5fe6e425995ba5d1871bc3a84', 'Shelf', '3d-builder/library/props/a3d_prop_e6aa5cd5fe6e425995ba5d1871bc3a84-195cf664.glb'],
  ['a3d_prop_f18a6361e5a24f359c340eb035f39677', 'Wood Doorway 1', '3d-builder/library/props/a3d_prop_f18a6361e5a24f359c340eb035f39677-ac7123fe.glb'],
  ['a3d_prop_377c195e303f464d830ca55f62f58f9b', 'Flourescent Fixture', '3d-builder/library/props/a3d_prop_377c195e303f464d830ca55f62f58f9b-436e1f1f.glb'],
  ['a3d_prop_8a77043f43954e6da06a925e5ae8d449', 'Staircase', '3d-builder/library/props/a3d_prop_8a77043f43954e6da06a925e5ae8d449-48476d74.glb'],
  ['a3d_prop_ed5eb475d0b44532a8aba212ef2adc33', 'Pipe Long', '3d-builder/library/props/a3d_prop_ed5eb475d0b44532a8aba212ef2adc33-cf1ffd9a.glb'],
  ['a3d_prop_96526fb576a944db8101173692af111b', 'Wide Dresser', '3d-builder/library/props/a3d_prop_96526fb576a944db8101173692af111b-9bbbe3ec.glb'],
  ['a3d_prop_2ed2d1d3463f4605a9469f2227028a88', 'Ducky', '3d-builder/library/props/a3d_prop_2ed2d1d3463f4605a9469f2227028a88-1edba66e.glb'],
  ['a3d_prop_88ff4c42951740e7bda247245ed5786b', 'window red', '3d-builder/library/props/a3d_prop_88ff4c42951740e7bda247245ed5786b-e5175713.glb'],
  ['a3d_prop_9f98f4e241a0431bba258e4bfbcb063f', 'ChickenCoop', '3d-builder/library/props/a3d_prop_9f98f4e241a0431bba258e4bfbcb063f-138f37ba.glb'],
  ['a3d_prop_2bdf7cc7e8654611a4772da189353cc8', 'metal scaffold', '3d-builder/library/props/a3d_prop_2bdf7cc7e8654611a4772da189353cc8-a0415dd1.glb'],
  ['a3d_prop_fb31e5b7b498415fa3995e879b918b18', 'Pedestal', '3d-builder/library/props/a3d_prop_fb31e5b7b498415fa3995e879b918b18-502b3644.glb'],
  ['a3d_prop_e47fd45f48564e3b853f13afa459354f', 'Wood Base 5', '3d-builder/library/props/a3d_prop_e47fd45f48564e3b853f13afa459354f-39fa3725.glb'],
  ['a3d_prop_126003e4cdfd4994b8f6bc54b568d642', 'Gate', '3d-builder/library/props/a3d_prop_126003e4cdfd4994b8f6bc54b568d642-af036f7b.glb'],
  ['a3d_prop_1e4155f4b00e427f82c854efa4afda78', 'Arch Gate', '3d-builder/library/props/a3d_prop_1e4155f4b00e427f82c854efa4afda78-b3374a7e.glb'],
  ['a3d_prop_60e6926e681b4f289de1bc41454d0c08', 'Windmill', '3d-builder/library/props/a3d_prop_60e6926e681b4f289de1bc41454d0c08-32f52e95.glb'],
  ['a3d_prop_a423e7963a2048069f465e178c3962ba', 'Hut', '3d-builder/library/props/a3d_prop_a423e7963a2048069f465e178c3962ba-1efcda15.glb'],
  ['a3d_prop_4827ec7a254d42538444164dc053edcf', 'Cottage', '3d-builder/library/props/a3d_prop_4827ec7a254d42538444164dc053edcf-ed9e5d49.glb'],
  ['a3d_prop_8ec052a4b656448b9cd7eff3094d02fe', 'Stair case', '3d-builder/library/props/a3d_prop_8ec052a4b656448b9cd7eff3094d02fe-a3f28866.glb'],
  ['a3d_prop_b99bad72ad3f4099bf881464b7692847', 'Scifi Crate', '3d-builder/library/props/a3d_prop_b99bad72ad3f4099bf881464b7692847-24c9e3d2.glb'],
  ['a3d_prop_0dee7bb355c24ab2a4ca69df09d401dd', 'Colonial House', '3d-builder/library/props/a3d_prop_0dee7bb355c24ab2a4ca69df09d401dd-924ea1f4.glb'],
  ['a3d_prop_e721df28ce994709b7b04dc729df8296', 'Doors Round Arch', '3d-builder/library/props/a3d_prop_e721df28ce994709b7b04dc729df8296-4614dab4.glb'],
  ['a3d_prop_5841c06f022f457eb1967944c7cc32bf', 'Feeling Crabby', '3d-builder/library/props/a3d_prop_5841c06f022f457eb1967944c7cc32bf-ae7731f6.glb'],
  ['a3d_prop_8cbf9ecd96464830984342547dbf47b9', 'Bull Ver', '3d-builder/library/props/a3d_prop_8cbf9ecd96464830984342547dbf47b9-be0bee29.glb'],
  ['a3d_prop_2bab8d214d454bd2b0ba609f59b8357b', 'Big Barn', '3d-builder/library/props/a3d_prop_2bab8d214d454bd2b0ba609f59b8357b-ff842148.glb'],
  ['a3d_prop_96bdb2d94c554bf3bf7375429a4ac033', 'Deer', '3d-builder/library/props/a3d_prop_96bdb2d94c554bf3bf7375429a4ac033-8c70659f.glb'],
  ['a3d_prop_6f05ae576fc542fba98f15208e4a6dab', 'Golden Gate bridge', '3d-builder/library/props/a3d_prop_6f05ae576fc542fba98f15208e4a6dab-3990e68a.glb'],
  ['a3d_prop_c563fb0494954960812c51c55b9af3e8', 'Gazebo', '3d-builder/library/props/a3d_prop_c563fb0494954960812c51c55b9af3e8-18059fd1.glb'],
  ['a3d_prop_87280475b4e24569a6341ae1b46b5ed8', 'White Horse', '3d-builder/library/props/a3d_prop_87280475b4e24569a6341ae1b46b5ed8-466c0b88.glb'],
  ['a3d_prop_64875985e1ca4b7393563d86552461ba', 'Kitchen Cooktop and Counter', '3d-builder/library/props/a3d_prop_64875985e1ca4b7393563d86552461ba-bb91e0ec.glb'],
  ['a3d_prop_151840c05eb24744a1c6d008575228af', 'Crane', '3d-builder/library/props/a3d_prop_151840c05eb24744a1c6d008575228af-c372c475.glb'],
  ['a3d_prop_3259a9f7bb88404e92241e30edff95bb', 'Bakery', '3d-builder/library/props/a3d_prop_3259a9f7bb88404e92241e30edff95bb-a9ba7895.glb'],
  ['a3d_prop_cdc04f8a41ba43cf9e609ba6610b52fc', 'Artemision: Temple of the Moon', '3d-builder/library/props/a3d_prop_cdc04f8a41ba43cf9e609ba6610b52fc-99cd8e91.glb'],
  ['a3d_prop_5ff2e498871a441692e807ad30744f15', 'Autumn Stoop', '3d-builder/library/props/a3d_prop_5ff2e498871a441692e807ad30744f15-39a4f309.glb'],
  ['a3d_prop_65af780049ad428cb37a8a2d929fbe9c', 'Temple of Life v0.2', '3d-builder/library/props/a3d_prop_65af780049ad428cb37a8a2d929fbe9c-bd0eb3f9.glb'],
  ['a3d_prop_877f5e42db4c4da891308d37dcf64701', 'Cyberpunk Platform', '3d-builder/library/props/a3d_prop_877f5e42db4c4da891308d37dcf64701-40455b42.glb'],
  ['a3d_prop_60c28474beff4f0eb331191121a8e477', 'Japanese Torii', '3d-builder/library/props/a3d_prop_60c28474beff4f0eb331191121a8e477-2e442eff.glb'],
]

const MOTIONS = [
  ['Thinking', '3d-builder/library/motions/a3d_motion_9e171d1481814cfeb4c0fac70c630296-a27b8ca0.fbx'],
  ['Head Nod Yes', '3d-builder/library/motions/a3d_motion_eb9eccf0147f412292b506bb8636b6fa-6d98985b.fbx'],
  ['Laughing', '3d-builder/library/motions/a3d_motion_f88a9dfd2f934234a072db80e2760b0a-3a314abf.fbx'],
  ['Acknowledging', '3d-builder/library/motions/a3d_motion_a38c767926c1412b88a5760e5613742a-027b0428.fbx'],
  ['Agreeing', '3d-builder/library/motions/a3d_motion_926f639fe11441ac8cb4a39e6939dcf1-2cbcc624.fbx'],
  ['Reacting Surprised', '3d-builder/library/motions/a3d_motion_5670c7c2f7d94f16b32961a31573a870-374491ff.fbx'],
  ['Angry Gesture', '3d-builder/library/motions/a3d_motion_83f3830c54f547b7a7eb8bf9a80ed63e-dc8a066b.fbx'],
  ['Rejected', '3d-builder/library/motions/a3d_motion_c287ae5ee07e424daea9f98dbc22cd3d-61499e46.fbx'],
  ['Annoyed Head Shake', '3d-builder/library/motions/a3d_motion_b6c40600673a4c2f9c8eeb321c6faa1a-094cc8fe.fbx'],
  ['Crying', '3d-builder/library/motions/a3d_motion_404c0b79cd914b75943116794fa50101-a839410d.fbx'],
  ['Scared', '3d-builder/library/motions/a3d_motion_4d2a3d482de54a6d830143b0a6805b9f-e194f5b1.fbx'],
  ['Disappointed', '3d-builder/library/motions/a3d_motion_e75813601a4b417a9a2b4e0574940884-b268d8d7.fbx'],
  ['Shaking Head No', '3d-builder/library/motions/a3d_motion_0d17a242c2744c7da4d8010c3062c73b-81216156.fbx'],
  ['Dismissing Gesture', '3d-builder/library/motions/a3d_motion_dd494daf6d9c43418a137e6dc75c7219-008e7b2f.fbx'],
  ['Shrugging', '3d-builder/library/motions/a3d_motion_bb5a2412b2374f19b9808c412bc0e84a-e6994015.fbx'],
  ['No', '3d-builder/library/motions/a3d_motion_f1b80a1567934912ad9a240f4be21368-af24088e.fbx'],
]

const PRIMITIVES = [
  ['BoxGeometry', '正方体', { width: 1, height: 1, depth: 1 }, 0.5],
  ['SphereGeometry', '球体', { radius: 0.5, widthSegments: 32, heightSegments: 16 }, 0.5],
  ['CylinderGeometry', '圆柱', { radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 32 }, 0.5],
]

const CHARACTER_COLORS = ['#7fb2e0', '#e0a37f', '#9fe07f', '#d07fe0', '#e0d06a', '#6ad0c0']

const TIERS = [
  { id: 'perf-stress-s', label: '压测 S', characters: 12, animated: 8, props: 30, primitives: 10, cameras: 3 },
  { id: 'perf-stress-m', label: '压测 M', characters: 30, animated: 20, props: 80, primitives: 25, cameras: 5 },
  { id: 'perf-stress-l', label: '压测 L', characters: 60, animated: 45, props: 180, primitives: 50, cameras: 10 },
]

const FPS = 24
const FRAME_END = 240

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const v = (x, y, z) => ({ x, y, z })
const round = (n) => Math.round(n * 1000) / 1000

/** 方阵摆放：返回第 i 个格子的世界坐标（以原点为中心）。 */
function gridSlot(i, count, spacing, offsetZ = 0) {
  const cols = Math.ceil(Math.sqrt(count))
  const row = Math.floor(i / cols)
  const col = i % cols
  const rows = Math.ceil(count / cols)
  return {
    x: round((col - (cols - 1) / 2) * spacing),
    z: round((row - (rows - 1) / 2) * spacing + offsetZ),
  }
}

function cameraNode(id, name, position, lookAt, isPrimary) {
  const dx = lookAt.x - position.x
  const dy = lookAt.y - position.y
  const dz = lookAt.z - position.z
  const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI
  const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI
  return {
    id,
    type: 'camera',
    name,
    visible: true,
    locked: false,
    transform: { position, rotation: v(round(pitch), round(yaw), 0), scale: v(1, 1, 1) },
    camera: {
      projection: 'perspective',
      fov: 50,
      fovAxis: 'vertical',
      near: 0.1,
      far: 2000,
      isPrimary,
      lookAt,
    },
  }
}

function buildTier(tier, seed) {
  const rand = rng(seed)
  const nodes = []
  const motionClips = []
  const motionPath = new Map()

  const charSpacing = 2
  const charExtent = Math.ceil(Math.sqrt(tier.characters)) * charSpacing
  for (let i = 0; i < tier.characters; i += 1) {
    const [assetId, name, modelUrl] = CHARACTERS[i % CHARACTERS.length]
    const { x, z } = gridSlot(i, tier.characters, charSpacing)
    const id = `user_chr_${i + 1}`
    nodes.push({
      id,
      type: 'character',
      name: `${name}_${i + 1}`,
      visible: true,
      locked: false,
      transform: { position: v(x, 0, z), rotation: v(0, round(rand() * 360 - 180), 0), scale: v(1, 1, 1) },
      metadata: { modelUrl, assetId, rig: 'mixamorig' },
      character: {
        placeholder: false,
        gender: 'unknown',
        motionId: null,
        appearance: { color: CHARACTER_COLORS[i % CHARACTER_COLORS.length] },
        label: { showLabel: true, scale: 1, yOffset: 0 },
        animation: { mode: 'pose', controlValues: {} },
      },
    })
    if (i < tier.animated) {
      const [motionName, fbxKey] = MOTIONS[i % MOTIONS.length]
      const motionAssetId = `user_${path.basename(fbxKey).replace(/\.fbx$/i, '')}`
      motionPath.set(motionAssetId, fbxKey)
      motionClips.push({
        id: `user_mc_${i + 1}`,
        source: 'user-library',
        sourceDuration: 3,
        frameStart: 0,
        frameEnd: FRAME_END,
        target: { type: 'character', nodeId: id },
        playback: { version: 1, speed: 1, loop: true, loopMode: 'repeat' },
        motion: {
          assetId: motionAssetId,
          name: motionName,
          source: 'user-library',
          sourceRig: 'mixamorig',
          url: fbxKey,
          inPlace: true,
          loop: true,
          speed: 1,
          time: 0,
        },
      })
    }
  }

  // 道具在人物方阵外围铺开，避免完全重叠
  const propSpacing = 4
  for (let i = 0; i < tier.props; i += 1) {
    const [assetId, name, modelUrl] = PROPS[i % PROPS.length]
    const { x, z } = gridSlot(i, tier.props, propSpacing, -(charExtent / 2 + 6) - Math.ceil(Math.sqrt(tier.props)) * propSpacing / 2)
    nodes.push({
      id: `user_prop_${i + 1}`,
      type: 'prop',
      name: `${name}_${i + 1}`,
      visible: true,
      locked: false,
      transform: { position: v(x, 0, z), rotation: v(0, round(rand() * 360 - 180), 0), scale: v(1, 1, 1) },
      metadata: { modelUrl, assetId },
      prop: { category: 'user' },
    })
  }

  const primSpacing = 1.5
  for (let i = 0; i < tier.primitives; i += 1) {
    const [kind, name, parameters, y] = PRIMITIVES[i % PRIMITIVES.length]
    const { x, z } = gridSlot(i, tier.primitives, primSpacing, charExtent / 2 + 4)
    nodes.push({
      id: `user_prim_${i + 1}`,
      type: 'primitive',
      name: `${name}_${i + 1}`,
      visible: true,
      locked: false,
      transform: { position: v(x, y, z), rotation: v(0, 0, 0), scale: v(1, 1, 1) },
      primitive: { kind, parameters, appearance: { color: '#cccccc' } },
    })
  }

  const radius = Math.max(12, charExtent * 1.6)
  for (let i = 0; i < tier.cameras; i += 1) {
    const angle = (i / tier.cameras) * Math.PI * 2
    const position = v(round(Math.sin(angle) * radius), round(radius * 0.45), round(Math.cos(angle) * radius))
    nodes.unshift(cameraNode(`camera_${tier.cameras - i}`, `Camera_${tier.cameras - i}`, position, v(0, 1.2, 0), false))
  }
  const primary = nodes.find((n) => n.id === 'camera_1')
  primary.camera.isPrimary = true

  return {
    type: 'biz/scene3d-director-document',
    pippitAssetId: '',
    extra: { customDraftName: `${tier.label}（${nodes.length} 节点）` },
    content: {
      version: 1,
      aspectRatio: 'auto',
      activeShotCameraNodeId: 'camera_1',
      environment: {
        background: { mode: 'color', skyColor: '#060608' },
        display: { characterLabelsVisible: true, groundVisible: true, groundHeight: 0, groundOpacity: 1 },
      },
      asset: { motionPath: [...motionPath].map(([id, p]) => ({ id, path: p })) },
      nodes,
      physicalConstraints: [],
      editorial: { version: 1, activeSequenceId: 'sequence_1', sequences: [{ id: 'sequence_1', clips: [] }] },
      timeline: {
        version: 1,
        fps: FPS,
        frameStart: 0,
        frameEnd: FRAME_END,
        usePreviewRange: false,
        animation: { fcurves: [], cameraMotionClips: [], motionTransitions: [], motionClips, pathMotionClips: [] },
      },
    },
  }
}

const outDir = path.resolve(__dirname, '../../apps/studio/drafts')
TIERS.forEach((tier, index) => {
  const doc = buildTier(tier, 20261003 + index)
  const file = path.join(outDir, `${tier.id}.json`)
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)
  const byType = {}
  for (const n of doc.content.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1
  console.log(`${tier.id}: ${doc.content.nodes.length} nodes ${JSON.stringify(byType)}, ${doc.content.timeline.animation.motionClips.length} motion clips`)
})
