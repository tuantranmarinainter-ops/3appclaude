const EXTRA_SUFFIX = /^[A-Za-z0-9_]+$/

const finiteVector = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite)
const isExtraName = name => typeof name === 'string' && name.startsWith('X_')

function mixamo65Parents() {
  const parents = new Map([['Hips', null]])
  for (const side of ['Left', 'Right']) {
    parents.set(side + 'UpLeg', 'Hips')
    parents.set(side + 'Leg', side + 'UpLeg')
    parents.set(side + 'Foot', side + 'Leg')
    parents.set(side + 'ToeBase', side + 'Foot')
    parents.set(side + 'Toe_End', side + 'ToeBase')
  }
  parents.set('Spine', 'Hips')
  parents.set('Spine1', 'Spine')
  parents.set('Spine2', 'Spine1')
  parents.set('Neck', 'Spine2')
  parents.set('Head', 'Neck')
  parents.set('HeadTop_End', 'Head')
  for (const side of ['Left', 'Right']) {
    parents.set(side + 'Shoulder', 'Spine2')
    parents.set(side + 'Arm', side + 'Shoulder')
    parents.set(side + 'ForeArm', side + 'Arm')
    parents.set(side + 'Hand', side + 'ForeArm')
    for (const finger of ['Index', 'Middle', 'Pinky', 'Ring', 'Thumb']) {
      parents.set(side + 'Hand' + finger + '1', side + 'Hand')
      parents.set(side + 'Hand' + finger + '2', side + 'Hand' + finger + '1')
      parents.set(side + 'Hand' + finger + '3', side + 'Hand' + finger + '2')
      parents.set(side + 'Hand' + finger + '4', side + 'Hand' + finger + '3')
    }
  }
  return parents
}

const MIXAMO65_PARENTS = mixamo65Parents()
export const MIXAMO65_BONE_PARENTS = Object.freeze([...MIXAMO65_PARENTS].map(([name, parent]) => Object.freeze([name, parent])))

function isMixamo65Core(records) {
  const core = records.filter(record => !isExtraName(record.name))
  if (core.length !== 65 || MIXAMO65_PARENTS.size !== 65) return false
  const byId = new Map(core.map(record => [record.id, record]))
  const byName = new Map(core.map(record => [record.name, record]))
  if (byName.size !== 65 || [...MIXAMO65_PARENTS.keys()].some(name => !byName.has(name))) return false
  for (const [name, parentName] of MIXAMO65_PARENTS) {
    const record = byName.get(name)
    const actualParent = record.parent ? byId.get(record.parent)?.name ?? null : null
    if (actualParent !== parentName) return false
  }
  return true
}

export function describeExtraBones(records) {
  if (!Array.isArray(records)) throw new TypeError('Rig records must be an array.')
  const byId = new Map(records.map(record => [record.id, record]))
  const byName = new Map()
  for (const record of records) {
    if (typeof record?.id !== 'string' || typeof record.name !== 'string' || byId.get(record.id) !== record) {
      throw new Error('Rig contains an invalid or duplicate bone id.')
    }
    if (byName.has(record.name)) throw new Error('Rig contains duplicate bone names: ' + record.name)
    byName.set(record.name, record)
  }

  const extras = records.filter(record => isExtraName(record.name))
  return extras.map(record => {
    const attachment = [...MIXAMO65_PARENTS.keys()].sort((a, b) => b.length - a.length)
      .find(name => record.name.startsWith('X_' + name + '_'))
    const suffix = attachment ? record.name.slice(attachment.length + 3) : ''
    if (!attachment || !EXTRA_SUFFIX.test(suffix)) throw new Error('Invalid extra bone name: ' + record.name)
    if (!record.parent || !byId.has(record.parent)) throw new Error('Extra bone has no valid parent: ' + record.name)

    const ancestry = new Set([record.id])
    let parent = byId.get(record.parent)
    while (parent && isExtraName(parent.name)) {
      if (ancestry.has(parent.id)) throw new Error('Extra bone hierarchy contains a cycle: ' + record.name)
      ancestry.add(parent.id)
      parent = parent.parent ? byId.get(parent.parent) : null
    }
    if (!parent || parent.name !== attachment) {
      throw new Error('Extra bone attachment does not match its core ancestor: ' + record.name)
    }

    const rest = record.rest
    if (!rest || !finiteVector(rest.p, 3) || !finiteVector(rest.q, 4) || !finiteVector(rest.s, 3)) {
      throw new Error('Extra bone has an invalid rest transform: ' + record.name)
    }
    if (rest.q.reduce((sum, value) => sum + value * value, 0) < 1e-12) {
      throw new Error('Extra bone has a zero rest rotation: ' + record.name)
    }

    return {
      name: record.name,
      parent: byId.get(record.parent).name,
      rest: {
        position: [...rest.p],
        rotation: [...rest.q],
        scale: [...rest.s],
      },
    }
  })
}

export function isExtraBoneName(name) {
  return isExtraName(name)
}

export function forExtendedRig(records, profile) {
  const extras = Array.isArray(records) ? records.filter(record => isExtraName(record?.name)) : []
  if (!extras.length) return []
  const coreCount = records.length - extras.length
  if (profile !== 'Mixamo' || coreCount !== 65 || !isMixamo65Core(records)) {
    throw new Error('GLB v1.1 extra bones require a Mixamo65 core; found ' + coreCount + ' core bones.')
  }
  return describeExtraBones(records)
}
