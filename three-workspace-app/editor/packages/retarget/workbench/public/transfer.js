/** One-click transfer orchestration. Callbacks keep the browser logic testable without duplicating server behavior. */
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
