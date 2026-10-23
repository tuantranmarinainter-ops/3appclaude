/** One-click transfer orchestration. Callbacks keep the browser logic testable without duplicating server behavior. */
export function suggestActionKey(requiredActions, actionNames) {
  const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const names = actionNames.map(normalize).filter(Boolean)
  if (!names.length) return null
  const aliases = [
    [['attack', 'attacking'], ['attack']], [['death', 'die', 'dead', 'dying'], ['fall']], [['walk', 'walking'], ['walk']],
    [['run', 'running', 'sprint', 'sprinting'], ['run', 'running']], [['idle', 'stand', 'standing'], ['idle', 'stand']], [['jump', 'jumping'], ['jump']], [['hit', 'hurt', 'damage'], ['hit']],
  ]
  for (const [terms, keys] of aliases) if (names.some((name) => terms.some((term) => name.split(' ').includes(term)))) {
    const required = requiredActions.find((action) => keys.includes(action.key))
    if (required) return required.key
  }
  return requiredActions.find((action) => {
    const terms = [action.key, action.label].map(normalize).filter((term) => term && term.length > 2)
    return terms.some((term) => names.some((name) => name === term || name.includes(term) || term.includes(name)))
  })?.key ?? null
}

export async function executeTransfer({ indices, toCharacter, toShared, normalize, importCharacter, importShared }) {
  const requested = [...new Set(indices)]
  if (!requested.length) throw new Error('Chưa chọn animation.')
  if (!toCharacter && !toShared) throw new Error('Chọn Bộ của nhân vật và/hoặc Kho dùng chung.')
  const run = await normalize(requested)
  if (!run) throw new Error('Lượt chuẩn hoá chưa hoàn tất.')
  const actions = run.manifest?.actions ?? []
  const completed = new Set(actions.map((action) => action.sourceActionIndex))
  const failed = requested.filter((index) => !completed.has(index))
  if (!actions.length) return { run, actions, failed, drafts: [], shared: null }
  const drafts = toCharacter ? (await importCharacter(run, actions)).drafts ?? [] : []
  const shared = toShared ? await importShared(run, actions) : null
  return { run, actions, failed, drafts, shared }
}
