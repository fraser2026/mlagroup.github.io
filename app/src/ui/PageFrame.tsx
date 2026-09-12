import { useEffect, useRef, type ReactNode } from 'react'
import { ContextRail, type ContextRailItem, type ContextRailMember } from './ContextRail'
import { useAuth } from '../auth/AuthProvider'
import { useShellChrome } from './shellChrome'
import styles from './PageFrame.module.css'

type Props = {
  children: ReactNode
  railItems?: ContextRailItem[]
  /** Set false only when a page truly has no use for the rail. Default: available. */
  showRail?: boolean
}

export function PageFrame({ children, railItems = [], showRail = true }: Props) {
  const { user } = useAuth()
  const { setRailAvailable, railOpen } = useShellChrome()
  const scrollRef = useRef<HTMLDivElement>(null)
  const members: ContextRailMember[] = user?.email
    ? [{ email: user.email, role: 'Member', you: true }]
    : []

  useEffect(() => {
    setRailAvailable(showRail)
    return () => setRailAvailable(false)
  }, [showRail, setRailAvailable])

  return (
    <div className={`${styles.frame} ${railOpen && showRail ? styles.frameRailOpen : ''}`}>
      <div
        ref={scrollRef}
        className={`${styles.main} ${showRail ? styles.mainWithRail : styles.mainSolo}`}
        data-ra-page-scroll
        data-ra-scroll="canvas"
        data-rail-open={railOpen && showRail ? '1' : '0'}
      >
        {children}
      </div>
      {showRail ? <ContextRail items={railItems} members={members} scrollRootRef={scrollRef} /> : null}
    </div>
  )
}
