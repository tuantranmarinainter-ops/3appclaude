import type * as THREE from 'three'
import type { DraftNode } from '../../contract/types'
import type { CameraGizmo } from '../gizmo/CameraGizmo'
import type { CharacterAnimator } from './MotionPlayer'
import type { Ual1Retargeter } from '../rig/applyRetarget'

export interface CharInstance {
  node: DraftNode
  root: THREE.Group
  inner: THREE.Object3D
  rig: 'mixamorig' | 'ual1' | 'direct'
  animator: CharacterAnimator
  retargeter: Ual1Retargeter | null
  restPose: Map<string, THREE.Quaternion>
  restPos: Map<string, THREE.Vector3>
  restScale?: Map<string, THREE.Vector3>
  /** rest 腿长（root 局部系，米），缩放姿势库根下沉；测不到为 null。 */
  legLength: number | null
  /**
   * 上次 pose 分支写骨骼时的输入；相同就沿用骨骼现状，不再解算。
   * 任何绕过 pose 分支改骨骼的路径（动作片段、关节拖拽、gizmo 拖拽）都必须置空。
   */
  poseCache?: { sig: string; bones: unknown } | null
  motionRootDelta?: THREE.Matrix4 | null
  motionRoot?: THREE.Group
}

export interface CamInstance {
  node: DraftNode
  camera: THREE.PerspectiveCamera
  gizmo: CameraGizmo
  lookAt: THREE.Vector3
}
