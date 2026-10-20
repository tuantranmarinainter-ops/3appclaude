import { Matrix4 } from 'three'
import { sceneBasisElements } from '../../evaluate/sceneBasis'

export function sceneBasisMatrix(value: unknown): Matrix4 {
  return new Matrix4().fromArray(sceneBasisElements(value))
}
