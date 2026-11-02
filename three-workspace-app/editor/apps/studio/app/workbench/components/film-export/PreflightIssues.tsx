export interface TaggedIssue { kind: 'error' | 'warning'; code: string; message: { vi: string; en: string }; segment?: number; nodeId?: string; clipId?: string; frame?: number }

/** B61: preflight messages shown right beside the item they concern. */
export function PreflightIssues({ items, vi }: { items: readonly TaggedIssue[] | undefined; vi: boolean }) {
  if (!items?.length) return null
  return <>{items.map((item, index) => <p key={`${item.kind}-${item.code}-${item.clipId ?? ''}-${item.frame ?? ''}-${index}`} role={item.kind === 'error' ? 'alert' : undefined} className={item.kind === 'error' ? 'wb-film-error' : 'wb-film-warn'}>
    {item.kind === 'error' ? (vi ? 'Lỗi' : 'Error') : (vi ? 'Lưu ý' : 'Warning')}{item.segment === undefined ? '' : ` · ${vi ? 'Đoạn' : 'Segment'} ${item.segment}`}: {vi ? item.message.vi : item.message.en}
  </p>)}</>
}
