import { evaluateDocumentFrames } from './evaluate.mjs'
import { inspectNodes } from './render.mjs'

const GROUND_TOLERANCE = 0.02

function round(value) { return Math.round(value * 10_000) / 10_000 }

function pair(a, b) {
  const lowA = a.bounds.min, highA = a.bounds.max
  const lowB = b.bounds.min, highB = b.bounds.max
  const gaps = ['x', 'y', 'z'].map(axis => Math.max(lowB[axis] - highA[axis], lowA[axis] - highB[axis], 0))
  const overlap = ['x', 'y', 'z'].map(axis => Math.min(highA[axis], highB[axis]) - Math.max(lowA[axis], lowB[axis]))
  const intersecting = overlap.every(value => value > 0)
  const originDistance = Math.hypot(a.origin.x - b.origin.x, a.origin.y - b.origin.y, a.origin.z - b.origin.z)
  const horizontalOriginDistance = Math.hypot(a.origin.x - b.origin.x, a.origin.z - b.origin.z)
  return {
    nodeIds: [a.nodeId, b.nodeId],
    originDistance: round(originDistance),
    horizontalOriginDistance: round(horizontalOriginDistance),
    boundsGap: round(Math.hypot(...gaps)),
    boundsIntersect: intersecting,
    ...(intersecting ? { overlapSize: Object.fromEntries(['x', 'y', 'z'].map((axis, index) => [axis, round(overlap[index])])) } : {}),
  }
}

function unavailable(code, message) {
  return { status: 'unavailable', issues: [{ code, message }] }
}

export async function evaluateSceneChecks(body) {
  const requested = [...new Set(body.checks ?? [])]
  const document = body.document
  const nodes = document.content.nodes.filter(node => ['character', 'prop', 'primitive'].includes(node.type))
  let measured = []
  let warnings = []
  let blockedRequests = []

  if (nodes.length) {
    try {
      const result = await inspectNodes({
        document,
        fcurves: body.fcurves ?? null,
        nodeIds: nodes.map(node => node.id),
        frames: [body.frame],
        localAssets: body.localAssets ?? {},
        transformOverrides: body.transformOverrides ?? {},
        publicAssetBase: '',
      })
      measured = result.nodes
      warnings = result.warnings
      blockedRequests = result.blockedRequests
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'renderer failed'
      const checks = Object.fromEntries(requested.map(name => [name, unavailable('CHECK_UNAVAILABLE', `Geometry inspection failed: ${reason}`)]))
      return { checks, issues: [{ code: 'CHECK_UNAVAILABLE', path: 'checks', message: `Geometry inspection failed: ${reason}` }], warnings, blockedRequests }
    }
  }

  const byId = new Map(measured.map(node => [node.nodeId, node]))
  const measuredNodes = measured.filter(node => node.status === 'measured' && node.type !== 'camera')
  const ground = document.content.environment?.display?.groundHeight ?? 0
  const issues = []
  const checks = {}
  const partial = measured.length !== nodes.length || measured.some(node => node.status !== 'measured')
  for (const node of nodes) {
    if (byId.get(node.id)?.status !== 'measured') issues.push({ code: 'CHECK_GEOMETRY_UNAVAILABLE', path: `nodes.${node.id}`, message: 'Topview could not measure mesh geometry for this node.' })
  }

  if (requested.includes('grounding')) {
    const results = nodes.map(node => {
      const measurement = byId.get(node.id)
      if (measurement?.status !== 'measured') return { nodeId: node.id, status: 'geometry-unavailable' }
      const bottomOffset = measurement.bounds.min.y - ground
      const status = Math.abs(bottomOffset) <= GROUND_TOLERANCE ? 'grounded' : bottomOffset > 0 ? 'floating' : 'penetrating'
      if (status === 'penetrating') issues.push({ code: 'MESH_BELOW_GROUND', path: `nodes.${node.id}`, message: `Measured mesh extends more than ${GROUND_TOLERANCE} m below the scene ground.` })
      return { nodeId: node.id, status, groundHeight: ground, bottomOffset: round(bottomOffset), tolerance: GROUND_TOLERANCE }
    })
    checks.grounding = { status: partial ? 'partial' : 'complete', nodes: results, issues: issues.filter(issue => issue.code === 'MESH_BELOW_GROUND') }
  }

  if (requested.includes('overlap')) {
    const pairs = []
    for (let i = 0; i < measuredNodes.length; i += 1) {
      for (let j = i + 1; j < measuredNodes.length; j += 1) pairs.push(pair(measuredNodes[i], measuredNodes[j]))
    }
    checks.overlap = { status: partial ? 'partial' : 'complete', pairs }
  }

  if (requested.includes('frustum')) {
    const cameraNodeId = body.cameraNodeId || document.content.activeShotCameraNodeId || nodes.find(node => node.type === 'camera')?.id
    if (!cameraNodeId || !document.content.nodes.some(node => node.id === cameraNodeId && node.type === 'camera')) {
      checks.frustum = unavailable('CAMERA_REQUIRED', 'Frustum evaluation requires a camera in the scene.')
    } else {
      try {
        const bounds = Object.fromEntries(measuredNodes.map(node => [node.nodeId, node.bounds]))
        const evaluated = evaluateDocumentFrames({
          document,
          frames: [body.frame],
          cameraNodeId,
          nodeBounds: { [String(body.frame)]: bounds },
          transformOverrides: body.transformOverrides ?? {},
        })
        const frame = evaluated.frames[0]
        const rows = nodes.map(node => {
          const metric = frame.nodes.find(row => row.nodeId === node.id)
          const isMeasured = byId.get(node.id)?.status === 'measured'
          return { nodeId: node.id, status: isMeasured ? 'measured' : 'origin-fallback', inFrustum: metric?.inFrustum ?? null, basis: metric?.basis ?? 'unavailable' }
        })
        for (const issue of evaluated.issues.filter(item => ['MESH_OUTSIDE_FRUSTUM', 'ORIGIN_OUTSIDE_FRUSTUM'].includes(item.code) && nodes.some(node => node.id === item.nodeId))) {
          issues.push({ code: issue.code, path: `nodes.${issue.nodeId}`, message: 'Visible node bounds do not intersect the selected camera frustum.' })
        }
        checks.frustum = { status: partial ? 'partial' : 'complete', cameraNodeId, nodes: rows, issues: issues.filter(issue => issue.code.endsWith('OUTSIDE_FRUSTUM')) }
      } catch (error) {
        const reason = error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'camera evaluation failed'
        checks.frustum = unavailable('CHECK_UNAVAILABLE', `Frustum evaluation failed: ${reason}`)
      }
    }
  }

  for (const [name, result] of Object.entries(checks)) {
    if (result.status === 'unavailable') for (const issue of result.issues) issues.push({ ...issue, path: `checks.${name}` })
    else if (result.status === 'partial') issues.push({ code: 'CHECK_PARTIAL', path: `checks.${name}`, message: `Some scene nodes could not be measured for ${name}.` })
  }
  return { checks, issues, warnings, blockedRequests }
}
