import { useState, type ReactElement } from 'react'
import type { DraftNode } from '../../contract/types'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { isDerivedTransformPath } from '../../evaluate/path/deriveWalk'
import { CameraLensPanel } from '../common/CameraLensPanel'
import { CameraSubjectPanel } from '../common/CameraSubjectPanel'
import { CameraTransformPanel } from '../common/CameraTransformPanel'
import { CharacterColorPanel } from '../common/CharacterColorPanel'
import { NodeNameEditor } from '../common/NodeNameEditor'
import { displayNodeName } from '../displayNames'
import { MultiTransformPanel, NodeTransformPanel, ResetTransformButton, TransformKeyframeButton } from '../common/NodeTransformPanel'
import { cx } from '../common/cx'
import { IconCharacter, IconObject, IconProp } from '../leftrail/icons'
import { FieldRow, InspectorSection, MultiPosePanel, PosePanel, ToggleRow } from './PosePanel'
import { CameraPathFacing } from './CameraPathFacing'
import { PathEditButton, PathSection } from './PathControls'
import { NODE_DELETE_LABEL } from './constants'
import { nodeTypeLabel } from './utils'
import { useCharacterInspectorTab } from './hooks/useCharacterInspectorTab'

function IconRename() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M4 20h4.2L19 9.2a1.6 1.6 0 0 0 0-2.3L17.1 5a1.6 1.6 0 0 0-2.3 0L4 15.8V20Z" />
      <path d="M13.4 6.6l4 4" />
    </svg>
  )
}

function InspectorTitle({
  node,
  icon,
  extra,
}: {
  node: DraftNode
  icon?: ReactElement
  extra?: ReactElement
}) {
  const t = useT()
  const [editRequest, setEditRequest] = useState(0)
  const renameable = node.type === 'character' || node.type === 'prop' || node.type === 'camera' || node.type === 'primitive'
  return (
    <div className="t3d-inspector-title">
      {icon}
      <span className="t3d-inspector-title-text">
        <NodeNameEditor
          nodeId={node.id}
          persistName={node.name}
          displayName={displayNodeName(t, node)}
          className="t3d-node-name-btn"
          editRequest={editRequest}
        />
      </span>
      {renameable || extra ? (
        <span className="t3d-inspector-title-action">
          {renameable ? (
            <button
              type="button"
              className="t3d-inspector-rename"
              aria-label={t('inspector.renameHint')}
              title={t('inspector.renameHint')}
              onClick={() => setEditRequest((n) => n + 1)}
            >
              <IconRename />
            </button>
          ) : null}
          {extra}
        </span>
      ) : null}
    </div>
  )
}

function PlaceActions({ nodeId, locked }: { nodeId: string; locked: boolean }) {
  return (
    <div className="t3d-place-actions">
      <PlaceOnSupportRow nodeId={nodeId} locked={locked} />
      <PlaceOnGroundButton nodeId={nodeId} locked={locked} />
    </div>
  )
}

function PlaceOnGroundButton({ nodeId, locked }: { nodeId: string; locked: boolean }) {
  const t = useT()
  const { useStore } = useDirector()
  const placeNodeOnGround = useStore((s) => s.placeNodeOnGround)
  return (
    <button
      type="button"
      className="t3d-inspector-action"
      disabled={locked}
      title={locked ? t('inspector.nodeLocked') : undefined}
      onClick={() => {
        if (locked) return
        placeNodeOnGround(nodeId)
      }}
    >
      {t('inspector.placeOnGround')}
    </button>
  )
}

function PlaceOnSupportRow({ nodeId, locked }: { nodeId: string; locked: boolean }) {
  const t = useT()
  const { useStore } = useDirector()
  const placeOnSupportPickingId = useStore((s) => s.placeOnSupportPickingId)
  const beginPlaceOnSupportPick = useStore((s) => s.beginPlaceOnSupportPick)
  const cancelPlaceOnSupportPick = useStore((s) => s.cancelPlaceOnSupportPick)
  const picking = placeOnSupportPickingId === nodeId
  return (
    <div className="t3d-place-on">
      <button
        type="button"
        className={cx('t3d-inspector-action', picking && 'is-active')}
        aria-pressed={picking}
        disabled={locked}
        title={locked ? t('inspector.nodeLocked') : t('inspector.placeOnSupportHint')}
        onClick={() => {
          if (locked) return
          if (picking) cancelPlaceOnSupportPick()
          else beginPlaceOnSupportPick(nodeId)
        }}
      >
        {t('inspector.placeOnSupport')}
      </button>
    </div>
  )
}

/** 多选面板：几何对象共用材质色。全是人物时多一个姿势页，一次套到所有未锁定人物。 */
export function MultiNodeInspector({ nodes }: { nodes: DraftNode[] }): ReactElement {
  const t = useT()
  const { useStore } = useDirector()
  const setCharacterAppearance = useStore((s) => s.setCharacterAppearance)
  const setObjectAppearance = useStore((s) => s.setObjectAppearance)
  const setNodesShowLabel = useStore((s) => s.setNodesShowLabel)
  const allCharacters = nodes.every((node) => node.type === 'character' && node.character)
  const [tab, setTab] = useState<'props' | 'pose'>('props')
  const showPose = allCharacters && tab === 'pose'
  const materialNodes = nodes.filter(
    (node) => node.type === 'character' || node.type === 'prop' || node.type === 'primitive',
  )
  const firstMaterial = materialNodes[0]
  const colorOf = (node: DraftNode): string => {
    if (node.character) return node.character.appearance.color
    if (node.prop) return node.prop.appearance?.color ?? '#cccccc'
    return node.primitive?.appearance?.color ?? '#cccccc'
  }
  const materialColor = firstMaterial
    ? materialNodes.every((node) => colorOf(node).toLowerCase() === colorOf(firstMaterial).toLowerCase())
      ? colorOf(firstMaterial)
      : '#cccccc'
    : '#cccccc'
  const applyMaterialColor = (color: string) => {
    for (const node of materialNodes) {
      if (node.character) setCharacterAppearance(node.id, { color })
      else setObjectAppearance(node.id, { color })
    }
  }
  const labelNodes = nodes.filter((node) => node.character || node.type === 'prop' || node.type === 'primitive')
  const labelShown = (node: DraftNode): boolean => {
    if (node.character) return node.character.label.showLabel !== false
    if (node.prop) return node.prop.label?.showLabel === true
    return node.primitive?.label?.showLabel === true
  }
  const labelsOn = labelNodes.length > 0 && labelNodes.every(labelShown)
  const labelsLocked = labelNodes.length > 0 && labelNodes.every((node) => node.locked)

  return (
    <div className={cx('t3d-inspector', showPose && 't3d-inspector-pose')}>
      <div className="t3d-inspector-title">
        <IconObject className="t3d-inspector-title-icon" />
        <span className="t3d-inspector-title-text">
          {t('inspector.multiSelectTitle', { count: nodes.length })}
        </span>
      </div>
      {allCharacters ? (
        <div className="t3d-inspector-tabs">
          <button
            type="button"
            className={cx('t3d-inspector-tab', tab === 'props' && 't3d-inspector-tab-active')}
            onClick={() => setTab('props')}
          >
            {t('inspector.tabProps')}
          </button>
          <button
            type="button"
            className={cx('t3d-inspector-tab', tab === 'pose' && 't3d-inspector-tab-active')}
            onClick={() => setTab('pose')}
          >
            {t('inspector.tabPose')}
          </button>
        </div>
      ) : null}
      {showPose ? (
        <MultiPosePanel nodes={nodes} />
      ) : (
        <>
          {labelNodes.length > 0 ? (
            <div className="t3d-inspector-flags">
              <ToggleRow
                label={t('inspector.showLabel')}
                checked={labelsOn}
                disabled={labelsLocked}
                onChange={(next) => setNodesShowLabel(labelNodes.map((node) => node.id), next)}
              />
            </div>
          ) : null}
          <InspectorSection
            title={t('timeline.transform')}
            defaultOpen={false}
            extra={
              <span className="t3d-inspector-section-actions">
                <TransformKeyframeButton
                  nodeId={nodes[0]?.id ?? ''}
                  locked={nodes.every((node) => node.locked)}
                />
              </span>
            }
          >
            <MultiTransformPanel nodeIds={nodes.map((node) => node.id)} />
          </InspectorSection>
          {materialNodes.length > 0 ? (
            <InspectorSection title={t('inspector.material')}>
              <CharacterColorPanel
                color={materialColor}
                onChange={applyMaterialColor}
              />
            </InspectorSection>
          ) : null}
          {materialNodes.length > 0 ? (
            <div className="t3d-place-actions">
              <PlaceNodesOnGroundButton nodes={materialNodes} />
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

/** 多选放在地面：能放的（未锁定的人物 / 道具 / 几何体）各自贴地，全锁定时禁用。 */
function PlaceNodesOnGroundButton({ nodes }: { nodes: DraftNode[] }) {
  const t = useT()
  const { useStore } = useDirector()
  const placeNodesOnGround = useStore((s) => s.placeNodesOnGround)
  const movable = nodes.filter((node) => !node.locked)
  const locked = movable.length === 0
  return (
    <button
      type="button"
      className="t3d-inspector-action"
      disabled={locked}
      title={locked ? t('inspector.nodeLocked') : undefined}
      onClick={() => {
        if (locked) return
        placeNodesOnGround(movable.map((node) => node.id))
      }}
    >
      {t('inspector.placeOnGround')}
    </button>
  )
}

export function NodePanel({ node }: { node: DraftNode }): ReactElement {
  const t = useT()
  const { useStore } = useDirector()
  const setObjectAppearance = useStore((s) => s.setObjectAppearance)
  const deleteNode = useStore((s) => s.deleteNode)
  const deleteKey = NODE_DELETE_LABEL[node.type]
  const locked = Boolean(node.locked)
  const primitiveLabelVisible = node.primitive?.label?.showLabel === true

  return (
    <div className="t3d-inspector">
      <InspectorTitle
        node={node}
        extra={
          node.type === 'camera' || node.type === 'primitive' ? undefined : (
            <span className="t3d-inspector-chip">{nodeTypeLabel(t, node.type)}</span>
          )
        }
      />
      {node.type === 'path' && !isDerivedTransformPath(node) ? <PathSection key={node.id} node={node} /> : null}
      {node.type === 'primitive' ? (
        <div className="t3d-inspector-flags">
          <ToggleRow
            label={t('inspector.showLabel')}
            checked={primitiveLabelVisible}
            disabled={locked}
            onChange={(showLabel) => setObjectAppearance(node.id, { showLabel })}
          />
        </div>
      ) : null}
      <InspectorSection
        key={`${node.id}:transform`}
        title={t('timeline.transform')}
        extra={
          <span className="t3d-inspector-section-actions">
            <TransformKeyframeButton nodeId={node.id} locked={locked} />
            {node.camera ? null : <ResetTransformButton nodeId={node.id} locked={locked} />}
          </span>
        }
      >
        {node.camera ? (
          <CameraTransformPanel cameraId={node.id} />
        ) : (
          <>
            <NodeTransformPanel nodeId={node.id} locked={locked} />
            {node.character ? <FieldRow label={t('inspector.color')} value={node.character.appearance.color} /> : null}
          </>
        )}
      </InspectorSection>
      {(node.type === 'primitive' || node.type === 'prop') ? (
        <InspectorSection title={t('inspector.material')}>
          <CharacterColorPanel
            color={
              node.type === 'prop'
                ? (node.prop?.appearance?.color ?? '#cccccc')
                : (node.primitive?.appearance?.color ?? '#cccccc')
            }
            disabled={locked}
            onChange={(next) => setObjectAppearance(node.id, { color: next })}
          />
        </InspectorSection>
      ) : null}
      {node.camera ? (
        <InspectorSection key={`${node.id}:lens`} title={t('inspector.lens')}>
          <CameraLensPanel cameraId={node.id} />
        </InspectorSection>
      ) : null}
      {node.camera ? (
        <InspectorSection key={`${node.id}:lookAt`} title={t('timeline.lookAt')}>
          <CameraSubjectPanel cameraId={node.id} />
        </InspectorSection>
      ) : null}
      {node.type === 'character' ? <PosePanel node={node} /> : null}
      {node.type === 'path' && !isDerivedTransformPath(node) ? <PathEditButton node={node} /> : null}
      {node.type === 'character' || node.type === 'prop' || node.type === 'primitive' ? (
        <PlaceActions nodeId={node.id} locked={locked} />
      ) : null}
      {deleteKey ? (
        <button
          type="button"
          className="t3d-inspector-danger"
          disabled={locked}
          title={locked ? t('inspector.nodeLocked') : undefined}
          onClick={() => {
            if (locked) return
            if (window.confirm(t('inspector.deleteConfirm', { name: displayNodeName(t, node) }))) {
              deleteNode(node.id)
            }
          }}
        >
          {t(deleteKey)}
        </button>
      ) : null}
      {node.camera ? <CameraPathFacing cameraId={node.id} /> : null}
    </div>
  )
}

function DeleteNodeButton({ node }: { node: DraftNode }) {
  const t = useT()
  const { useStore } = useDirector()
  const deleteNode = useStore((s) => s.deleteNode)
  const labelKey = NODE_DELETE_LABEL[node.type]
  const locked = Boolean(node.locked)
  if (!labelKey) return null
  return (
    <button
      type="button"
      className="t3d-inspector-danger"
      disabled={locked}
      title={locked ? t('inspector.nodeLocked') : undefined}
      onClick={() => {
        if (locked) return
        if (window.confirm(t('inspector.deleteConfirm', { name: displayNodeName(t, node) }))) {
          deleteNode(node.id)
        }
      }}
    >
      {t(labelKey)}
    </button>
  )
}

export function PropInspector({ node: n }: { node: DraftNode }) {
  const t = useT()
  const { useStore } = useDirector()
  const setObjectAppearance = useStore((s) => s.setObjectAppearance)
  const locked = Boolean(n.locked)
  const color = n.prop?.appearance?.color ?? '#cccccc'
  const showLabel = n.prop?.label?.showLabel === true
  return (
    <div className="t3d-inspector">
      <InspectorTitle node={n} icon={<IconProp className="t3d-inspector-title-icon" />} />
      <div className="t3d-inspector-flags">
        <ToggleRow
          label={t('inspector.showLabel')}
          checked={showLabel}
          disabled={locked}
          onChange={(next) => setObjectAppearance(n.id, { showLabel: next })}
        />
      </div>
      <InspectorSection
        title={t('timeline.transform')}
        extra={
          <span className="t3d-inspector-section-actions">
          <TransformKeyframeButton nodeId={n.id} locked={locked} />
          <ResetTransformButton nodeId={n.id} locked={locked} />
        </span>
        }
      >
        <NodeTransformPanel nodeId={n.id} locked={locked} />
      </InspectorSection>
      <InspectorSection title={t('inspector.material')}>
        <CharacterColorPanel
          color={color}
          disabled={locked}
          onChange={(next) => setObjectAppearance(n.id, { color: next })}
        />
      </InspectorSection>
      <PlaceActions nodeId={n.id} locked={locked} />
      <DeleteNodeButton node={n} />
    </div>
  )
}

/**
 * 角色节点检查器：顶层「属性 | 姿势」页签。
 * 属性页可手工改变换（整组打关键帧、缩放默认同比），没有骨骼开关。
 */
export function CharacterInspector({ node: n }: { node: DraftNode }) {
  const t = useT()
  const { useStore } = useDirector()
  const setCharacterAppearance = useStore((s) => s.setCharacterAppearance)
  const [tab, setTab] = useCharacterInspectorTab(n.id)
  const locked = Boolean(n.locked)
  const showLabel = n.character?.label.showLabel !== false
  return (
    <div className={cx('t3d-inspector', tab === 'pose' && 't3d-inspector-pose')}>
      <InspectorTitle node={n} icon={<IconCharacter className="t3d-inspector-title-icon" />} />
      <div className="t3d-inspector-tabs">
        <button
          type="button"
          className={cx('t3d-inspector-tab', tab === 'props' && 't3d-inspector-tab-active')}
          aria-disabled="false"
          onClick={() => setTab('props')}
        >
          {t('inspector.tabProps')}
        </button>
        <button
          type="button"
          className={cx('t3d-inspector-tab', tab === 'pose' && 't3d-inspector-tab-active')}
          aria-disabled="false"
          onClick={() => setTab('pose')}
        >
          {t('inspector.tabPose')}
        </button>
      </div>
      {tab === 'pose' ? (
        <PosePanel node={n} />
      ) : (
        <>
          <div className="t3d-inspector-flags">
            <ToggleRow
              label={t('inspector.showLabel')}
              checked={showLabel}
              disabled={locked}
              onChange={(next) => setCharacterAppearance(n.id, { showLabel: next })}
            />
          </div>
          <InspectorSection
            title={t('timeline.transform')}
            extra={
          <span className="t3d-inspector-section-actions">
          <TransformKeyframeButton nodeId={n.id} locked={locked} />
          <ResetTransformButton nodeId={n.id} locked={locked} />
        </span>
        }
          >
            <NodeTransformPanel nodeId={n.id} locked={locked} />
          </InspectorSection>
          {n.character ? (
            <InspectorSection title={t('inspector.material')}>
              <CharacterColorPanel
                color={n.character.appearance.color}
                disabled={locked}
                onChange={(color) => setCharacterAppearance(n.id, { color })}
              />
            </InspectorSection>
          ) : null}
          <PlaceActions nodeId={n.id} locked={locked} />
        </>
      )}
    </div>
  )
}
