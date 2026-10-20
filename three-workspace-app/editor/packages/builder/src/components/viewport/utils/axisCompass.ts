const AXIS_COLOR_X = '#e5484d'
const AXIS_COLOR_Y = '#30c84d'
const AXIS_COLOR_Z = '#4d7cff'


export interface AxisCompassRotation {
  x: number
  y: number
  z: number
}

export interface AxisProjection {
  key: 'x' | 'y' | 'z'
  label: string
  color: string
  sx: number
  sy: number
  depth: number
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180
}

/** 复刻 three.js YXZ 旋转：世界轴投到相机视图空间（与主相机 1:1）。 */
export function projectAxes(rotation: AxisCompassRotation): AxisProjection[] {
  const x = degToRad(rotation.x)
  const y = degToRad(rotation.y)
  const z = degToRad(rotation.z)

  const a = Math.cos(x)
  const b = Math.sin(x)
  const c = Math.cos(y)
  const d = Math.sin(y)
  const e = Math.cos(z)
  const f = Math.sin(z)

  const ce = c * e
  const cf = c * f
  const de = d * e
  const df = d * f

  const te0 = ce + df * b
  const te1 = a * f
  const te2 = cf * b - de
  const te4 = de * b - cf
  const te5 = a * e
  const te6 = df + ce * b
  const te8 = a * d
  const te9 = -b
  const te10 = a * c

  const axes: AxisProjection[] = [
    { key: 'x', label: 'X', color: AXIS_COLOR_X, sx: te0, sy: -te4, depth: te8 },
    { key: 'y', label: 'Y', color: AXIS_COLOR_Y, sx: te1, sy: -te5, depth: te9 },
    { key: 'z', label: 'Z', color: AXIS_COLOR_Z, sx: te2, sy: -te6, depth: te10 },
  ]
  return axes.sort((p, q) => p.depth - q.depth)
}
