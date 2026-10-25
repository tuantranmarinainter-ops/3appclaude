import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  DEFAULT_GROUND_VIEW_OPTIONS,
  normalizeGroundViewOptions,
  type GroundViewOptions,
} from '../../contract/groundView'
import { GRID_NAME, GROUND_CHECKER_NAME, GROUND_NAME } from '../objects/environment'
import {
  buildCheckerPlan,
  checkerCellColor,
  GroundCheckerView,
} from '../objects/groundChecker'

const ENABLED: GroundViewOptions = { enabled: true, style: 'bw', cellSize: 1, opacity: 0.9 }

describe('N6 normalizeGroundViewOptions', () => {
  it('returns defaults for empty input and never mutates the input', () => {
    expect(normalizeGroundViewOptions(null)).toEqual(DEFAULT_GROUND_VIEW_OPTIONS)
    expect(normalizeGroundViewOptions(undefined)).toEqual(DEFAULT_GROUND_VIEW_OPTIONS)
    const input: Partial<GroundViewOptions> = { enabled: true, style: 'color', cellSize: 2, opacity: 0.5 }
    const snapshot = { ...input }
    expect(normalizeGroundViewOptions(input)).toEqual(input)
    expect(input).toEqual(snapshot)
  })

  it('rejects unknown styles and cell sizes, clamps opacity', () => {
    const bad = normalizeGroundViewOptions({
      style: 'rainbow' as GroundViewOptions['style'],
      cellSize: 3,
      opacity: 4,
    })
    expect(bad.style).toBe('bw')
    expect(bad.cellSize).toBe(1)
    expect(bad.opacity).toBe(1)
    expect(normalizeGroundViewOptions({ opacity: 0 }).opacity).toBe(0.15)
    expect(normalizeGroundViewOptions({ opacity: Number.NaN }).opacity).toBe(DEFAULT_GROUND_VIEW_OPTIONS.opacity)
    expect(normalizeGroundViewOptions({ enabled: true }).enabled).toBe(true)
    expect(normalizeGroundViewOptions({}).enabled).toBe(false)
  })
})

describe('N6 checker pattern', () => {
  it('black/white alternates and is symmetric around the origin cell', () => {
    expect(checkerCellColor('bw', 0, 0)).not.toBe(checkerCellColor('bw', 1, 0))
    expect(checkerCellColor('bw', 1, 0)).toBe(checkerCellColor('bw', -1, 0))
    expect(checkerCellColor('bw', 0, 0)).toBe(checkerCellColor('bw', 1, 1))
    expect(checkerCellColor('bw', 0, 0)).toBe(checkerCellColor('bw', -2, 0))
  })

  it('color style repeats every 4 cells and differs between neighbours', () => {
    expect(checkerCellColor('color', 0, 0)).toBe(checkerCellColor('color', 4, 0))
    expect(checkerCellColor('color', 0, 0)).toBe(checkerCellColor('color', 0, -4))
    expect(checkerCellColor('color', 0, 0)).not.toBe(checkerCellColor('color', 1, 0))
    expect(checkerCellColor('color', 0, 0)).not.toBe(checkerCellColor('color', 0, 1))
  })

  it('plan: cell counts follow cell size; coordinate labels only in numbers style', () => {
    expect(buildCheckerPlan({ ...ENABLED, cellSize: 0.5 }).cellsAcross).toBe(120)
    expect(buildCheckerPlan({ ...ENABLED, cellSize: 1 }).cellsAcross).toBe(60)
    expect(buildCheckerPlan({ ...ENABLED, cellSize: 2 }).cellMeters).toBe(2)
    expect(buildCheckerPlan({ ...ENABLED, cellSize: 5 }).cellsAcross).toBe(12)
    expect(buildCheckerPlan(ENABLED).labels).toEqual([])

    const plan = buildCheckerPlan({ ...ENABLED, style: 'numbers' })
    expect(plan.labels).toContainEqual({ text: '5', x: 5, z: 0 })
    expect(plan.labels).toContainEqual({ text: '-25', x: 0, z: -25 })
    expect(plan.labels.filter((label) => label.text === '0')).toEqual([{ text: '0', x: 0, z: 0 }])
    // Số trên trục X mang toạ độ x (z = 0), số trên trục Z mang toạ độ z (x = 0).
    for (const label of plan.labels) {
      if (label.x !== 0) expect(label.z).toBe(0)
      if (label.z !== 0) expect(label.x).toBe(0)
    }
  })
})

describe('N6 GroundCheckerView', () => {
  function sceneWithGround() {
    const scene = new THREE.Scene()
    const groundMaterial = new THREE.MeshBasicMaterial({ color: 0x1e1e1e })
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), groundMaterial)
    ground.name = GROUND_NAME
    const grid = new THREE.Group()
    grid.name = GRID_NAME
    scene.add(ground, grid)
    return { scene, ground, grid, groundMaterial }
  }

  it('shows its own plane above the ground, hides doc ground + grid, and restores them on hide', () => {
    const { scene, ground, grid, groundMaterial } = sceneWithGround()
    const textures: THREE.Texture[] = []
    const view = new GroundCheckerView(() => {
      const texture = new THREE.Texture()
      textures.push(texture)
      return texture
    })

    view.apply(scene, { ...ENABLED, opacity: 0.5 }, 0.25)
    const plane = scene.children.find((child) => child.name === GROUND_CHECKER_NAME) as THREE.Mesh
    expect(plane).toBeDefined()
    expect(plane.visible).toBe(true)
    expect(plane.position.y).toBeCloseTo(0.254, 9)
    expect((plane.material as THREE.MeshBasicMaterial).opacity).toBe(0.5)
    expect((plane.material as THREE.MeshBasicMaterial).map).toBe(textures[0])
    expect(ground.visible).toBe(false)
    expect(grid.visible).toBe(false)
    expect(view.active).toBe(true)
    // Mặt sàn của tài liệu không bị đụng vào: cùng vật liệu, cùng hình học.
    expect(ground.material).toBe(groundMaterial)

    // Đổi kiểu ô: dùng lại cùng một mặt phẳng, chỉ thay texture.
    view.apply(scene, { ...ENABLED, style: 'numbers', opacity: 0.5 }, 0.25)
    expect(scene.children.filter((child) => child.name === GROUND_CHECKER_NAME)).toHaveLength(1)
    expect(textures).toHaveLength(2)
    expect((plane.material as THREE.MeshBasicMaterial).map).toBe(textures[1])

    view.hide(scene, true)
    expect(plane.visible).toBe(false)
    expect(ground.visible).toBe(true)
    expect(grid.visible).toBe(true)
    expect(view.active).toBe(false)

    view.dispose(scene)
    expect(scene.children.some((child) => child.name === GROUND_CHECKER_NAME)).toBe(false)
  })

  it('hide without a prior apply leaves doc ground and grid untouched', () => {
    const { scene, ground, grid } = sceneWithGround()
    const view = new GroundCheckerView(() => new THREE.Texture())
    view.hide(scene, true)
    expect(ground.visible).toBe(true)
    expect(grid.visible).toBe(true)
    expect(scene.children.some((child) => child.name === GROUND_CHECKER_NAME)).toBe(false)
  })
})
