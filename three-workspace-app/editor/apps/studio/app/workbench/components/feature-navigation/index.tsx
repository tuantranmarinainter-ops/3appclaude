'use client'

import { useEffect } from 'react'
import type { DirectorApi } from '@topview/3d-builder'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { featureUnavailable, WORKSPACE_PANELS, type Workspace } from '../../../../src/workspaceNavigation'
import { useFeatureTree } from './hooks/useFeatureTree'

const groupLabels: Record<string, { vi: string; en: string }> = {
  '1.1': { vi: 'Điều hướng ứng dụng', en: 'App navigation' },
  '1.2': { vi: 'Dự án và tài nguyên', en: 'Projects and assets' },
  '1.3': { vi: 'Chuẩn hóa rig và animation', en: 'Rig and animation standardization' },
  '1.4': { vi: 'Dựng cảnh', en: 'Scene building' },
  '1.5': { vi: 'Chỉnh sửa animation', en: 'Animation editing' },
  '1.6': { vi: 'Công cụ cục bộ', en: 'Local tools' },
  '1.7': { vi: 'Xuất BBS FS', en: 'BBS FS export' },
  '2': { vi: 'Chẩn đoán', en: 'Diagnostics' },
}

function EditorSelection({ api, onChange }: { api: DirectorApi; onChange: (id: string | null) => void }) {
  const id = api.useStore((state) => state.selection?.kind === 'node' ? state.selection.nodeId : null)
  useEffect(() => onChange(id), [id, onChange])
  return null
}

export function FeatureNavigation({ projectId, project, locale, workspace, api, selectedNodeId, onSelectionChange, onOpen }: {
  projectId: string
  project: UnifiedProject | null
  locale: string
  workspace: Workspace
  api: DirectorApi | null
  selectedNodeId: string | null
  onSelectionChange: (id: string | null) => void
  onOpen: (panelId: string) => void
}) {
  const vi = locale === 'vi'
  const tree = useFeatureTree(projectId)
  return <section className="wb-feature-navigation" aria-label={vi ? 'Chức năng' : 'Features'}>
    {api && <EditorSelection api={api} onChange={onSelectionChange} />}
    <label className="wb-unified-search"><span className="wb-sr-only">{vi ? 'Tìm workspace hoặc chức năng' : 'Search workspaces or features'}</span>
      <input id="wb-feature-search" ref={tree.searchRef} value={tree.search} onChange={(event) => tree.changeSearch(event.target.value)} onKeyDown={tree.escape} placeholder={vi ? 'Tìm chức năng… Ctrl+K' : 'Find a feature… Ctrl+K'} />
    </label>
    <div className="wb-feature-tools">
      <button type="button" onClick={() => tree.setOpen(tree.results.nodes.filter((node) => !node.panelId).map((node) => node.id), true)}>{vi ? 'Mở hết' : 'Expand all'}</button>
      <button type="button" onClick={() => tree.setOpen(tree.results.nodes.filter((node) => !node.panelId).map((node) => node.id), false)}>{vi ? 'Thu gọn' : 'Collapse all'}</button>
      {tree.search && <button type="button" onClick={() => { tree.changeSearch(''); tree.searchRef.current?.focus() }}>{vi ? 'Xóa tìm' : 'Clear'}</button>}
    </div>
    <p className="wb-tree-count" role="status">{tree.results.count} {vi ? 'chức năng' : 'features'}</p>
    <div ref={tree.treeRef} className="wb-workspace-tree" aria-label={vi ? 'Workspace và chức năng' : 'Workspaces and features'} role="tree" onKeyDown={tree.onTreeKeyDown}>
      {tree.visible.map((node) => {
        const group = !node.panelId
        const reason = featureUnavailable(node, project, selectedNodeId, locale)
        const label = !node.panelId ? groupLabels[node.id]?.[vi ? 'vi' : 'en'] ?? node.label : node.label
        const siblings = tree.results.nodes.filter((item) => item.parentId === node.parentId)
        const open = tree.shownExpansion.has(node.id)
        const active = node.workspace === workspace
        return <button key={node.id} type="button" role="treeitem" data-feature-id={node.id} aria-label={label} aria-level={group ? 1 : 2} aria-posinset={siblings.findIndex((item) => item.id === node.id) + 1} aria-setsize={siblings.length}
          aria-expanded={group ? open : undefined} aria-selected={group && active} aria-disabled={!!reason} aria-describedby={reason ? `wb-feature-reason-${node.id}` : undefined}
          tabIndex={tree.focusId === node.id ? 0 : -1} className={`${group ? 'wb-feature-group' : 'wb-feature-leaf'}${group && active ? ' is-active' : ''}`}
          onFocus={() => tree.setFocusedId(node.id)} onClick={() => {
            if (reason) return
            if (group) {
              tree.setOpen([node.id], !open)
              if (node.workspace !== 'shared') onOpen(WORKSPACE_PANELS[node.workspace])
            } else if (node.panelId) onOpen(node.panelId)
          }}>
          <span>{group && <span aria-hidden="true">{open ? '⌄ ' : '› '}</span>}{label}</span>
          <small>{node.id} · {node.workspace === 'shared' ? (vi ? 'Dùng chung' : 'Shared') : node.workspace}</small>
          {reason && <small className="wb-feature-reason" id={`wb-feature-reason-${node.id}`}>{reason}</small>}
        </button>
      })}
    </div>
    {!tree.visible.length && <p className="wb-tree-empty" role="status">{vi ? 'Không tìm thấy chức năng.' : 'No matching features.'}</p>}
  </section>
}
