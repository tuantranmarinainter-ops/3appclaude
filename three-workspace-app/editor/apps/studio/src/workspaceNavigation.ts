import { validateFeatureTree, type FeatureNode, type FeatureWorkspace, type UnifiedProject } from '@bbs/animation-workspace-shared'
import manifest from './featureManifest.json'

export type Workspace = Exclude<FeatureWorkspace, 'shared'>
type Message = { vi: string; en: string }
export type PanelTarget = {
  workspace?: Workspace
  selector?: string
  editorPanel?: 'objects' | 'camera' | 'inspector' | 'timeline'
  unavailable?: Message
}
const pending = { vi: 'Chưa triển khai panel này.', en: 'This panel is not implemented yet.' }
const diagnostic = { vi: 'Mục tài liệu/chẩn đoán; xem đặc tả trong docs.', en: 'Documentation/diagnostics entry; see the specification in docs.' }

export const FEATURE_PANELS: Record<string, PanelTarget> = {
  shell: { selector: '#wb-project-title' },
  'feature-tree': { selector: '#wb-feature-search' },
  'workspace-switcher': { selector: '.wb-workspace-tree [tabindex="0"]' },
  'asset-profile': { selector: '#wb-assets-title' },
  transform: { workspace: 'scene', editorPanel: 'inspector', selector: '.t3d-inspector-title' },
  'motion-binding': { workspace: 'animation', selector: '#wb-animation-title' },
  'camera-shot': { workspace: 'scene', editorPanel: 'camera', selector: '.t3d-leftrail-pane-title' },
  history: { selector: '#wb-history-title' },
  'project-import': { unavailable: { vi: 'Nhập project tại workbench sau khi đóng project hiện tại.', en: 'Import a project from the workbench after closing this project.' } },
  'retarget-source': { workspace: 'retarget', selector: '#wb-retarget-title' },
  'retarget-mapping': { workspace: 'retarget', selector: '#wb-mapping-title' },
  'retarget-target': { workspace: 'retarget', selector: '#wb-retarget-session-title' },
  'scene-layout': { workspace: 'scene', editorPanel: 'objects', selector: '.t3d-leftrail-pane-title' },
  'scene-camera': { workspace: 'scene', editorPanel: 'camera', selector: '.t3d-leftrail-pane-title' },
  'scene-checks': { workspace: 'scene', selector: '#wb-scene-render-title' },
  'animation-rig': { workspace: 'animation', editorPanel: 'inspector', selector: '.t3d-inspector-title' },
  'animation-motion': { workspace: 'animation', selector: '.wb-animation-creation' },
  'animation-io': { unavailable: pending },
  'local-cli': { unavailable: { vi: 'Dùng unified_cli trong terminal; chưa có panel CLI.', en: 'Use unified_cli in a terminal; no CLI panel is available.' } },
  conversion: { unavailable: pending },
  'local-api': { unavailable: { vi: 'API/MCP dùng broker local; chưa có panel kết nối.', en: 'API/MCP uses the local broker; no connection panel is available.' } },
  'film-export': { workspace: 'scene', selector: '#wb-film-export-title' },
  'film-playback': { unavailable: pending },
  'film-editable': { unavailable: pending },
  'diagnostics-tests': { unavailable: diagnostic },
  'diagnostics-runtime': { unavailable: diagnostic },
  'diagnostics-licenses': { unavailable: diagnostic },
  'diagnostics-package': { unavailable: diagnostic },
}

export const FEATURES = manifest as FeatureNode[]
validateFeatureTree(FEATURES, Object.keys(FEATURE_PANELS))
export const WORKSPACE_PANELS: Record<Workspace, string> = { scene: 'scene-layout', retarget: 'retarget-source', animation: 'animation-motion' }

export function normalizeWorkspaceSearch(value: string): string {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
}

export function searchFeatures(nodes: readonly FeatureNode[], query: string): { nodes: FeatureNode[]; count: number } {
  const needle = normalizeWorkspaceSearch(query)
  const numericId = /^\d+(?:\.\d+)*$/.test(needle)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const matched = nodes.filter((node) => {
    let cursor: FeatureNode | undefined = node
    while (cursor) {
      if (numericId ? cursor.id === needle || cursor.id.startsWith(`${needle}.`) : normalizeWorkspaceSearch([cursor.id, cursor.label, ...cursor.keywords].join(' ')).includes(needle)) return true
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
    }
    return false
  })
  const keep = new Set(matched.map((node) => node.id))
  for (const node of matched) {
    let parentId = node.parentId
    while (parentId) { keep.add(parentId); parentId = byId.get(parentId)?.parentId ?? null }
  }
  return { nodes: nodes.filter((node) => keep.has(node.id)), count: matched.filter((node) => node.panelId).length }
}

export function featureUnavailable(node: FeatureNode, project: UnifiedProject | null, selectedNodeId: string | null, locale: string): string | null {
  const language = locale === 'vi' ? 'vi' : 'en'
  const panel = node.panelId ? FEATURE_PANELS[node.panelId] : undefined
  if (panel?.unavailable) return panel.unavailable[language]
  const capabilities: Record<string, boolean> = {
    'project-open': !!project,
    'selected-node': !!selectedNodeId && !!project?.scene.content.nodes.some((item) => item.id === selectedNodeId),
    'selected-character': !!selectedNodeId && !!project && Object.values(project.characters).some((item) => item.nodeId === selectedNodeId),
    motion: !!project && Object.keys(project.motions).length > 0,
    'two-profiles': !!project && Object.keys(project.skeletons).length >= 2,
    character: !!project && Object.keys(project.characters).length > 0,
  }
  const reasons: Record<string, Message> = {
    'project-open': { vi: 'Đang tải project.', en: 'Project is loading.' },
    'selected-node': { vi: 'Chọn một đối tượng trong Scene.', en: 'Select an object in Scene.' },
    'selected-character': { vi: 'Chọn một Character có rig trong Scene.', en: 'Select a rigged Character in Scene.' },
    motion: { vi: 'Nhập FBX Motion trong Retarget trước.', en: 'Import an FBX motion in Retarget first.' },
    'two-profiles': { vi: 'Nhập asset để có profile xương nguồn và đích.', en: 'Import assets with source and target skeleton profiles.' },
    character: { vi: 'Thêm Character từ Assets vào Scene.', en: 'Add a Character to Scene from Assets.' },
  }
  const missing = node.requires.find((required) => !capabilities[required])
  return missing ? reasons[missing]?.[language] ?? `Unavailable capability: ${missing}` : null
}
