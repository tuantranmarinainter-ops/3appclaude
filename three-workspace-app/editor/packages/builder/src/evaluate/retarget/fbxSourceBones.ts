interface SourceNode {
  name: string
  isBone?: boolean
  ID?: number
  parent: SourceNode | null
  userData: Record<string, unknown>
  position: { x: number; y: number; z: number }
  quaternion: { x: number; y: number; z: number; w: number }
  scale: { x: number; y: number; z: number }
}

/** FBXLoader creates identity child aliases when one FBX model bone serves multiple meshes. */
export function isFbxBoneAlias(object: SourceNode): boolean {
  const parent = object.parent
  if (!object.isBone || !parent?.isBone) return false
  const id = object.ID
  const parentId = parent.ID
  // Object3D.clone preserves userData but drops FBXLoader's custom ID property.
  const sameModel = Number.isSafeInteger(id) ? id === parentId : id === undefined && parentId === undefined &&
    typeof object.userData.originalName === 'string' && object.userData.originalName === parent.userData.originalName
  return sameModel && object.name === parent.name &&
    !Object.prototype.hasOwnProperty.call(object.userData, 'transformData') &&
    object.position.x === 0 && object.position.y === 0 && object.position.z === 0 && object.quaternion.x === 0 && object.quaternion.y === 0 && object.quaternion.z === 0 && object.quaternion.w === 1 &&
    object.scale.x === 1 && object.scale.y === 1 && object.scale.z === 1
}

export function fbxSourceBones<T extends SourceNode>(root: { traverse(visitor: (object: T) => void): void }): Array<T & { readonly isBone: true }> {
  const bones: Array<T & { readonly isBone: true }> = []
  const names = new Set<string>()
  root.traverse((object) => {
    if (!object.isBone || isFbxBoneAlias(object)) return
    if (!object.name || names.has(object.name)) throw new TypeError('FBX skeleton contains a missing or duplicate bone name')
    names.add(object.name)
    bones.push(object as T & { readonly isBone: true })
  })
  return bones
}
