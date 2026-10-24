export type LibraryFilterAction = {
  name: string
  nameVi?: string
  category?: string
  tags?: readonly string[]
}

export function searchable(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase()
}

export function filterLibraryActions<T extends LibraryFilterAction>(actions: readonly T[], query: string, category: string): T[] {
  const needle = searchable(query.trim())
  return actions.filter((action) => (!category || action.category === category) &&
    (!needle || searchable([action.name, action.nameVi ?? '', action.category ?? '', ...(action.tags ?? [])].join(' ')).includes(needle)))
}
