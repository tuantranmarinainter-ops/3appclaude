import { useState, type ReactElement } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { computeViewHiddenNodeIds, isBackgroundNode } from '../../contract/sceneView'
import { useT } from '../../locale'
import { buildNodeSelection, nodeIdsOf, toggleNodeIds } from '../../stores/nodeSelection'
import { cx } from '../common/cx'
import { Tooltip } from '../common/Tooltip'
import { IconCamera, IconCharacter, IconEye, IconEyeOff, IconLock, IconObject, IconProp, IconScene, IconUnlock } from './icons'
import { SearchField } from './SearchField'
import { buildObjectRows, treeIconKind, type TreeRow } from './utils'

function RowIcon({ kind }: { kind: ReturnType<typeof treeIconKind> }): ReactElement {
  if (kind === 'scene') return <IconObject className="t3d-leftrail-tree-scene-icon" />
  if (kind === 'character') return <IconCharacter />
  if (kind === 'camera') return <IconCamera />
  if (kind === 'prop') return <IconProp />
  return <IconObject />
}

export function ObjectTree(): ReactElement {
  const t = useT()
  const { useStore } = useDirector()
  const [query, setQuery] = useState('')
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const film = useStore((s) => s.workspaceMode === 'film')
  const writeLocked = useStore((s) => s.writeLocked)
  const charactersOnlyView = useStore((s) => s.charactersOnlyView)
  const backgroundViewHidden = useStore((s) => s.backgroundViewHidden)
  const { select, setNodeFlags, openInspector, setBackgroundViewHidden } = useStore()
  const nodes = doc?.content.nodes ?? []
  const rows = buildObjectRows(nodes, query, t)
  const selectedIds = new Set(nodeIdsOf(selection))
  // N5: dòng bị bộ lọc xem ẩn được làm mờ trong cây (chỉ là cách xem, khác với ẩn trong tài liệu).
  const viewHiddenIds = computeViewHiddenNodeIds(nodes, {
    charactersOnly: charactersOnlyView,
    backgroundHidden: backgroundViewHidden,
  })
  const backgroundCount = nodes.filter((node) => isBackgroundNode(node)).length

  return (
    <div className="t3d-leftrail-object">
      <SearchField value={query} placeholder={t('library.searchObjects')} onChange={setQuery} />
      <div className="t3d-leftrail-tree">
        {rows.map((row) => row.type === 'background' ? (
          <BackgroundGroupRow
            key={row.id}
            label={t('library.backgroundGroup')}
            count={backgroundCount}
            viewHidden={backgroundViewHidden}
            hideLabel={t('library.hide')}
            showLabel={t('library.show')}
            onToggle={() => setBackgroundViewHidden(!backgroundViewHidden)}
          />
        ) : (
          <TreeRowView
            key={row.id}
            row={row}
            viewDimmed={viewHiddenIds.has(row.id)}
            selected={row.type === 'scene' ? selection == null : selectedIds.has(row.id)}
            sceneLabel={t('library.sceneRoot')}
            hideLabel={t('library.hide')}
            showLabel={t('library.show')}
            lockLabel={t('library.lock')}
            unlockLabel={t('library.unlock')}
            readOnly={film || writeLocked}
            onSelect={(shiftKey) => {
              if (film) return
              if (row.type === 'scene') {
                select(null)
                return
              }
              if (shiftKey) {
                const current = selection?.kind === 'node' ? selection : null
                select(buildNodeSelection(toggleNodeIds(current?.nodeIds, current?.nodeId, row.id)))
                openInspector()
                return
              }
              select(buildNodeSelection([row.id]))
              openInspector()
            }}
            onToggleVisible={() => {
              if (film || !row.node) return
              setNodeFlags(row.node.id, { visible: row.node.visible === false })
            }}
            onToggleLocked={() => {
              if (film || !row.node) return
              setNodeFlags(row.node.id, { locked: !row.node.locked })
            }}
          />
        ))}
      </div>
    </div>
  )
}

function BackgroundGroupRow({
  label,
  count,
  viewHidden,
  hideLabel,
  showLabel,
  onToggle,
}: {
  label: string
  count: number
  viewHidden: boolean
  hideLabel: string
  showLabel: string
  onToggle: () => void
}): ReactElement {
  return (
    <div className="t3d-leftrail-tree-row t3d-leftrail-tree-group-row">
      <span className="t3d-leftrail-tree-main t3d-leftrail-tree-group-main">
        <IconScene />
        <span>{`${label} (${count})`}</span>
      </span>
      {/* Nút mắt của cả nhóm Hậu cảnh: chỉ đổi cách xem (lọc xem), không ghi cờ ẩn vào tài liệu. */}
      <span className="t3d-leftrail-tree-flags is-always">
        <Tooltip label={viewHidden ? showLabel : hideLabel} side="top">
          <button type="button" className={cx(viewHidden && 'is-on')} onClick={onToggle}>
            {viewHidden ? <IconEyeOff /> : <IconEye />}
          </button>
        </Tooltip>
      </span>
    </div>
  )
}

function TreeRowView({
  row,
  viewDimmed,
  selected,
  sceneLabel,
  hideLabel,
  showLabel,
  lockLabel,
  unlockLabel,
  onSelect,
  onToggleVisible,
  onToggleLocked,
  readOnly,
}: {
  row: TreeRow
  viewDimmed?: boolean
  selected: boolean
  sceneLabel: string
  hideLabel: string
  showLabel: string
  lockLabel: string
  unlockLabel: string
  readOnly?: boolean
  onSelect: (shiftKey: boolean) => void
  onToggleVisible: () => void
  onToggleLocked: () => void
}): ReactElement {
  const hidden = row.node?.visible === false
  const locked = Boolean(row.node?.locked)
  return (
    <div
      className={cx('t3d-leftrail-tree-row', selected && 't3d-leftrail-tree-row-active')}
      style={{ paddingLeft: 10 + row.depth * 14 }}
    >
      <button type="button" className="t3d-leftrail-tree-main" onClick={(e) => onSelect(e.shiftKey)}>
        <RowIcon kind={treeIconKind(row.type)} />
        <span className={cx((hidden || viewDimmed) && 't3d-leftrail-tree-hidden')}>
          {row.type === 'scene' ? sceneLabel : row.name}
        </span>
      </button>
      {/* 隐藏 / 锁定按钮常驻 DOM，由 CSS 决定显隐：选中、悬停、键盘聚焦到这一行时才出现。 */}
      {row.type !== 'scene' && row.node ? (
        <span className="t3d-leftrail-tree-flags">
          <Tooltip label={hidden ? showLabel : hideLabel} side="top">
            <button
              type="button"
              className={cx(hidden && 'is-on')}
              disabled={readOnly}
              onClick={onToggleVisible}
            >
              {hidden ? <IconEyeOff /> : <IconEye />}
            </button>
          </Tooltip>
          <Tooltip label={locked ? unlockLabel : lockLabel} side="top">
            <button
              type="button"
              className={cx(locked && 'is-on')}
              disabled={readOnly}
              onClick={onToggleLocked}
            >
              {locked ? <IconLock /> : <IconUnlock />}
            </button>
          </Tooltip>
        </span>
      ) : null}
    </div>
  )
}
