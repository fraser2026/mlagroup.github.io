import type { ReactNode } from 'react'
import { Menu, PanelRight, PanelRightClose, Search } from 'lucide-react'
import { Breadcrumbs } from './Breadcrumbs'
import { CopyLink } from './CopyLink'
import { Button } from './Button'
import { DelayTip } from './DelayTip'
import { Icon } from './Icon'
import { useShellChrome } from './shellChrome'
import styles from './TopChrome.module.css'

type Props = {
  actions?: ReactNode
  showRailToggle?: boolean
  onOpenCommand?: () => void
  /** Mobile only: opens the off-canvas primary nav. */
  onOpenNav?: () => void
  navOpen?: boolean
}

function searchShortcutLabel() {
  if (typeof navigator === 'undefined') return 'Ctrl K'
  const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')
  return mac ? '⌘K' : 'Ctrl K'
}

export function TopChrome({ actions, showRailToggle = true, onOpenCommand, onOpenNav, navOpen = false }: Props) {
  const { railOpen, toggleRail, railAvailable } = useShellChrome()
  const showToggle = showRailToggle && railAvailable
  const searchTip = `Search (${searchShortcutLabel()})`

  return (
    <header className={styles.chrome}>
      {onOpenNav ? (
        <button
          type="button"
          className={styles.menuBtn}
          aria-label="Open menu"
          aria-controls="ra-primary-nav"
          aria-expanded={navOpen}
          onClick={onOpenNav}
        >
          <Icon icon={Menu} size="sm" />
        </button>
      ) : null}
      <div className={styles.left}>
        <Breadcrumbs />
      </div>
      <div className={styles.right}>
        {actions}
        {onOpenCommand ? (
          <DelayTip text={searchTip} mode="always">
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenCommand}
              aria-label={searchTip}
              className={styles.searchBtn}
            >
              <Icon icon={Search} size="sm" />
              <span className={styles.searchHint}>Search</span>
              <kbd className={styles.kbd}>{searchShortcutLabel()}</kbd>
            </Button>
          </DelayTip>
        ) : null}
        <CopyLink />
        {showToggle ? (
          <DelayTip text="On this page" mode="always">
            <Button
              variant="ghost"
              size="sm"
              selected={railOpen}
              className={styles.railToggle}
              onClick={toggleRail}
              aria-label={railOpen ? 'Hide On this page' : 'Show On this page'}
            >
              <Icon icon={railOpen ? PanelRightClose : PanelRight} size="sm" />
            </Button>
          </DelayTip>
        ) : null}
      </div>
    </header>
  )
}
