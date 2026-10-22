/** BBS film guide; the host supplies project aspect and BBS-look camera-view state. */
export function FilmFrameOverlay({ aspect }: { aspect: number | null }) {
  if (aspect === null) return null
  if (!Number.isFinite(aspect) || aspect <= 0) throw new RangeError('Film aspect must be a positive finite number')
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none', containerType: 'size', overflow: 'hidden' }}>
      <div style={{
        ['--t3d-film-aspect' as string]: String(aspect),
        position: 'absolute', left: '50%', top: '50%',
        width: 'min(100cqw, calc(100cqh * var(--t3d-film-aspect)))',
        aspectRatio: String(aspect), transform: 'translate(-50%, -50%)',
        border: '1px solid rgba(255, 255, 255, 0.42)',
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.7)',
      }} />
    </div>
  )
}
