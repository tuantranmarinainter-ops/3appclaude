import { Group, Matrix4, type Object3D } from 'three'
import { sceneBasisMatrix } from './sceneBasisMatrix'

export function attachModelBasis(parent: Object3D, model: Object3D, value: unknown): void {
  const basis = value === undefined ? new Matrix4() : sceneBasisMatrix(value)
  if (basis.equals(new Matrix4())) { parent.add(model); return }
  const adapter = new Group()
  adapter.matrixAutoUpdate = false
  adapter.matrix.copy(basis)
  adapter.add(model)
  parent.add(adapter)
}
