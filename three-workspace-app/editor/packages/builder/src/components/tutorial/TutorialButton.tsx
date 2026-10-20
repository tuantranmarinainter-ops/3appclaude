import { useLocale, useT } from '../../locale'
import { Tooltip } from '../common/Tooltip'
import { buildTutorialUrl } from './utils'

export function TutorialGlyph() {
  return (
    <svg className="t3d-topbar-glyph t3d-topbar-glyph-tutorial" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M3.2 7.15 9 4.4l5.8 2.75L9 9.9 3.2 7.15Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M5.15 8.2v3.15c0 .7 1.72 1.7 3.85 1.7s3.85-1 3.85-1.7V8.2"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path d="M14.8 7.3v4.15" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function TutorialButton({ disabled }: { disabled?: boolean }) {
  const t = useT()
  const locale = useLocale()

  return (
    <Tooltip label={t('tutorial.title')}>
      <button
        type="button"
        className="t3d-topbar-icon-btn"
        aria-label={t('tutorial.title')}
        disabled={disabled}
        onClick={() => window.open(buildTutorialUrl(locale), '_blank', 'noopener,noreferrer')}
      >
        <TutorialGlyph />
      </button>
    </Tooltip>
  )
}
