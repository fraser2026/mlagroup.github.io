import { useEffect, useRef, type ReactNode } from 'react'
import { ContextRail, type ContextRailItem } from './ContextRail'
import { useShellChrome } from './shellChrome'
import styles from './PageFrame.module.css'

type Props = {
  children: ReactNode
  railItems?: ContextRailItem[]
  /** Set false only when a page truly has no use for the rail. Default: available. */
  showRail?: boolean
  /**
   * Full-height workspaces (e.g. policy draft) that must stay usable with the rail open.
   * Skips the scroll-spy bottom pad so two panes are not crushed.
   */
  denseWorkspace?: boolean
  /** @deprecated Unused. Kept so call sites that passed userEmail keep typechecking. */
  userEmail?: string | null
}

export function PageFrame({
  children,
  railItems = [],
  showRail = true,
  denseWorkspace = false,
}: Props) {
  const { setRailAvailable, railOpen } = useShellChrome()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setRailAvailable(showRail)
    return () => setRailAvailable(false)
  }, [showRail, setRailAvailable])

  const mainClass = denseWorkspace
    ? styles.mainDense
    : showRail
      ? styles.mainWithRail
      : styles.mainSolo

  return (
    <div className={`${styles.frame} ${railOpen && showRail ? styles.frameRailOpen : ''}`}>
      <div
        ref={scrollRef}
        className={`${styles.main} ${mainClass}`}
        data-ra-page-scroll
        data-ra-scroll="canvas"
        data-rail-open={railOpen && showRail ? '1' : '0'}
        data-dense={denseWorkspace ? '1' : '0'}
      >
        {children}
      </div>
      {showRail ? <ContextRail items={railItems} scrollRootRef={scrollRef} /> : null}
    </div>
  )
}
