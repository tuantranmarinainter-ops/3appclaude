import type { ReactElement } from 'react'
import type { HostAdapter } from '../../host/types'
import { CatalogImage } from '../library/AssetGrid'
import { cx } from '../common/cx'
import type { HoverDiagram } from './types'
import { IconCamera, IconCameraFilled, IconCharacter } from './icons'
import { PrimitiveThumb } from './PrimitiveThumb'

export interface AssetCardProps {
  name: string
  kind?: string
  previewKey?: string
  icon?: 'camera' | 'cameraFilled'
  primitiveKind?: string
  diagram?: ReactElement | null
  hoverDiagram?: HoverDiagram
  variant?: 'default' | 'motion'
  busy?: boolean
  disabled?: boolean
  hoverPreview?: boolean
  adapter: HostAdapter
  onClick: () => void
  onHoverStart: (el: HTMLElement, assetKey: string | undefined, alt: string, diagram?: HoverDiagram) => void
  onHoverEnd: () => void
}

export function AssetCard({
  name,
  kind,
  previewKey,
  icon,
  primitiveKind,
  diagram,
  hoverDiagram,
  variant = 'default',
  busy,
  disabled,
  hoverPreview = true,
  adapter,
  onClick,
  onHoverStart,
  onHoverEnd,
}: AssetCardProps): ReactElement {
  const resolvedHoverDiagram: HoverDiagram | undefined = hoverDiagram ?? (primitiveKind ? { kind: 'primitive', id: primitiveKind } : undefined)
  const isCamera = icon === 'camera' || icon === 'cameraFilled'
  const showHover = hoverPreview && (Boolean(resolvedHoverDiagram) || (Boolean(previewKey) && !isCamera))
  return (
    <button
      type="button"
      className={cx(
        't3d-leftrail-card',
        variant === 'motion' && 't3d-leftrail-card-motion',
      )}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={(e) => showHover && onHoverStart(e.currentTarget, previewKey, name, resolvedHoverDiagram)}
      onMouseLeave={onHoverEnd}
    >
      <div className="t3d-leftrail-card-preview">
        {previewKey ? (
          <CatalogImage adapter={adapter} assetKey={previewKey} alt={name} />
        ) : primitiveKind ? (
          <PrimitiveThumb kind={primitiveKind} />
        ) : diagram ? (
          diagram
        ) : icon === 'cameraFilled' ? (
          <IconCameraFilled className="t3d-leftrail-card-camera-icon" />
        ) : icon === 'camera' ? (
          <IconCamera className="t3d-leftrail-card-camera-icon" />
        ) : (
          <IconCharacter className="t3d-leftrail-card-icon" />
        )}
      </div>
      <span className="t3d-leftrail-card-name">{busy ? '…' : name}</span>
      {kind ? <span className="t3d-leftrail-card-kind">{kind}</span> : null}
    </button>
  )
}
