import { useContext, useEffect, useRef, type ReactNode } from 'react'
import { AuthContext } from '../auth/AuthProvider'
import { ContextRail, type ContextRailItem, type ContextRailMember } from './ContextRail'
import { useShellChrome } from './shellChrome'
import styles from './PageFrame.module.css'

type Props = {
  children: ReactNode
  railItems?: ContextRailItem[]
  /** Set false only when a page truly has no use for the rail. Default: available. */
  showRail?: boolean
  /** Optional signed-in email for the context rail when AuthProvider is absent. */
  userEmail?: string | null
}

export function PageFrame({ children, railItems = [], showRail = true, userEmail = null }: Props) {
  const auth = useContext(AuthContext)
  const { setRailAvailable, railOpen } = useShellChrome()
  const scrollRef = useRef<HTMLDivElement>(null)
  const email = userEmail ?? auth?.user?.email ?? null
  const members: ContextRailMember[] = email
    ? [{ email, role: 'Member', you: true }]
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
