import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import { originalFilmHeightTransform } from '../src/filmCharacterHeight'
import { inspectFilmActorTransform } from '../src/filmManifest'

test('native mesh extrema and nonzero floors reach 1.8 and 3.6 blocks with exact ground contact', () => {
  for (const model of [{ rawHeight: 2.03, floor: -0.25, unit: 1, sourceHeight: 2.03, target: 1.8 }, { rawHeight: 5.828, floor: -1.993, unit: 0.4915394, sourceHeight: 1.9, target: 3.6 }]) {
    const actorScale = model.target / model.sourceHeight
    const transform = originalFilmHeightTransform(model.rawHeight * model.unit, model.unit, model.floor, model.target, actorScale)
    const form = new Matrix4().makeTranslation(0, transform.formOffsetY, 0).multiply(new Matrix4().makeScale(transform.formScale, transform.formScale, transform.formScale))
    const foot = new Vector3(0, model.floor, 0).applyMatrix4(form), head = new Vector3(0, model.floor + model.rawHeight, 0).applyMatrix4(form)
    assert.ok(Math.abs(foot.y) < 1e-12)
    assert.ok(Math.abs(head.y - foot.y - model.target) < 1e-12)
    // Source root translation goes through inverse importer units, then the native BBS form exactly once.
    const sourceTravel = 1.25
    const gameTravel = sourceTravel * transform.sourcePositionScale / model.unit * transform.formScale
    assert.ok(Math.abs(gameTravel - sourceTravel * actorScale) < 1e-12)
  }
})

test('calibrated actor scaling is opt-in, uniform and constant, retaining rejection of shear and arbitrary scale', () => {
  const uniform = new Matrix4().makeScale(2, 2, 2)
  assert.ok(inspectFilmActorTransform(uniform.toArray(), 0).issues.some((issue) => issue.code === 'TRANSFORM_SCALE'))
  assert.equal(inspectFilmActorTransform(uniform.toArray(), 0, undefined, 2).issues.length, 0)
  assert.ok(inspectFilmActorTransform(new Matrix4().makeScale(2, 3, 2).toArray(), 0, undefined, 2).issues.some((issue) => issue.code === 'TRANSFORM_SCALE'))
  uniform.elements[4] = 0.25
  assert.ok(inspectFilmActorTransform(uniform.toArray(), 0, undefined, 2).issues.some((issue) => issue.code === 'TRANSFORM_SHEAR'))
})
