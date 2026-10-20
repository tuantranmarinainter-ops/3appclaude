import type { EditorViewDirection } from '../../bridge/useEngine'
import { useT } from '../../locale'
import { projectAxes, type AxisCompassRotation } from './utils/axisCompass'
export type { AxisCompassRotation } from './utils/axisCompass'

const DIRECTIONS = {
  x: ['right', 'left'],
  y: ['top', 'bottom'],
  z: ['front', 'back'],
} as const

export function AxisCompass({ rotation, onSelect, activeDirection }: {
  activeDirection?: EditorViewDirection | null
  rotation: AxisCompassRotation
  onSelect?: (direction: EditorViewDirection) => void
}) {
  const t = useT()
  const axes = projectAxes(rotation)
  const ends = axes.flatMap((axis) => ([1, -1] as const).map((sign) => ({
    ...axis,
    sign,
    depth: axis.depth * sign,
    direction: DIRECTIONS[axis.key][sign === 1 ? 0 : 1],
    opposite: DIRECTIONS[axis.key][sign === 1 ? 1 : 0],
  }))).sort((a, b) => a.depth - b.depth)

  return (
    <div data-projection={activeDirection ? 'orthographic' : 'perspective'} className="t3d-axis-compass" onPointerDown={(event) => event.stopPropagation()}>
      <div className="t3d-axis-compass-surface">
        <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
          {axes.map((axis) => (
            <line key={axis.key} x1={42 - axis.sx * 29} y1={42 - axis.sy * 29}
              x2={42 + axis.sx * 29} y2={42 + axis.sy * 29}
              stroke={axis.color} strokeWidth="2" opacity="0.65" />
          ))}
        </svg>
        {ends.map((end) => {
          // 正对的两个端点重叠；点击朝向自己的端点可翻到反面。
          const direction = end.depth > 0.999 ? end.opposite : end.direction
          const label = t(`viewport.view${direction[0].toUpperCase()}${direction.slice(1)}`)
          return (
            <button key={`${end.key}${end.sign}`} type="button"
              className="t3d-axis-compass-end"
              aria-pressed={activeDirection === end.direction} title={label} aria-label={label} disabled={!onSelect}
              onClick={() => onSelect?.(direction)}
              style={{
                left: 42 + end.sx * end.sign * 29,
                top: 42 + end.sy * end.sign * 29,
                color: end.sign === 1 ? '#fff' : end.color,
                background: end.sign === 1 ? end.color : 'var(--t3d-dock-surface)',
                borderColor: end.color,
                zIndex: Math.round((end.depth + 1) * 100),
              }}
            >
              {end.sign === 1 ? end.label : `−${end.label}`}
            </button>
          )
        })}
      </div>
    </div>
  )
}
