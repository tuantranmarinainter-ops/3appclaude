import { useRef, type ReactElement } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { CONTENT_WIDTH_DEFAULT, CONTENT_WIDTH_MAX, CONTENT_WIDTH_MIN } from '../../stores/EditorStore'
import { useT } from '../../locale'
import { cx } from '../common/cx'
import { Tooltip } from '../common/Tooltip'
import { CatalogPane } from './CatalogPane'
import { TAB_LABEL, TAB_ORDER } from './constants'
import { useFlashOnChange } from './hooks/useFlashOnChange'
import { usePanelResize } from './hooks/usePanelResize'
import { IconRail } from './IconRail'
import { IconChevron } from './icons'
import { selectedTimelineNodeId } from '../timeline/utils'
import { ObjectTree } from './ObjectTree'

export function LeftRail(): ReactElement | null {
  const t = useT()
  const { useStore, adapter, documentId } = useDirector()
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const film = useStore((s) => s.workspaceMode === 'film')
  const libraryOpen = useStore((s) => s.libraryOpen)
  const tab = useStore((s) => s.libraryTab)
  const width = useStore((s) => s.libraryContentWidth)
  const flash = useStore((s) => s.libraryFlash)
  const { toggleLibrary, setLibraryTab, setLibraryContentWidth } = useStore()
  const contentRef = useRef<HTMLDivElement>(null)
  const clampAvailableWidth = (value: number) => {
    const body = contentRef.current?.closest('.t3d-body')
    const inspector = body?.querySelector<HTMLElement>('.t3d-side')
    const iconRail = contentRef.current?.previousElementSibling as HTMLElement | null
    const available = (body?.clientWidth ?? window.innerWidth) - (inspector?.getBoundingClientRect().width ?? 0) - (iconRail?.getBoundingClientRect().width ?? 0) - 300
    return Math.min(CONTENT_WIDTH_MAX, Math.max(CONTENT_WIDTH_MIN, Math.round(Math.min(value, available))))
  }
  const { onPointerDown, onDoubleClick } = usePanelResize(contentRef, width, libraryOpen, setLibraryContentWidth, {
    clamp: clampAvailableWidth,
    defaultValue: CONTENT_WIDTH_DEFAULT,
    storageKey: 'topview.builder.panel.libraryWidth',
  })
  useFlashOnChange(contentRef, flash)

  if (!doc) return null
  const resolvedTab = film ? 'object' : TAB_ORDER.includes(tab) ? tab : 'object'

  return (
    <div className="t3d-leftrail-slot">
      <div className="t3d-leftrail">
        <IconRail
          tab={resolvedTab}
          open={libraryOpen}
          t={t}
          tabs={film ? ['object'] : TAB_ORDER}
          onSelect={film ? () => setLibraryTab('object') : setLibraryTab}
          onToggle={toggleLibrary}
          assignAction={!film && adapter.assignAnimation ? {
            label: t('library.assignAnimation'),
            onClick: () => { void adapter.assignAnimation?.(documentId, doc ? selectedTimelineNodeId(doc, selection) : null).catch(() => undefined) },
          } : undefined}
        />
        <div
          ref={contentRef}
          className={cx('t3d-leftrail-content', !libraryOpen && 'is-collapsed')}
          data-tutorial-anchor="leftrail"
        >
          <div className="t3d-leftrail-pane-title">{t(TAB_LABEL[resolvedTab])}</div>
          {film || resolvedTab === 'object' ? <ObjectTree /> : <CatalogPane tab={resolvedTab} />}
        </div>
        {libraryOpen ? (
          <>
            <div
              className="t3d-leftrail-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('library.resizeLeftPanel')}
              onPointerDown={onPointerDown}
              onDoubleClick={onDoubleClick}
            />
            <Tooltip label={t('library.collapseContent')} side="right">
              <button type="button" className="t3d-leftrail-collapse" onClick={toggleLibrary}>
                <IconChevron className="t3d-leftrail-chevron-icon" />
              </button>
            </Tooltip>
          </>
        ) : null}
      </div>
    </div>
  )
}

export { LeftRail as LibraryPanel }
