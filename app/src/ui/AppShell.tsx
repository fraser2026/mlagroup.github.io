import { NavLink, useNavigate } from 'react-router-dom'
import { startTransition, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Boxes,
  ChevronDown,
  ClipboardList,
  KeyRound,
  LayoutGrid,
  LogOut,
  Plug,
  ScrollText,
  Settings,
  Building2,
  UserRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { motion, useReducedMotion } from 'motion/react'
import { Icon } from './Icon'
import { TopChrome } from './TopChrome'
import { useTheme } from '../theme/ThemeProvider'
import styles from './AppShell.module.css'

export type NavItem = {
  to: string
  label: string
  end?: boolean
  icon?: LucideIcon
}

export type NavGroup = {
  id: string
  label: string
  items: NavItem[]
  defaultOpen?: boolean
}

type Props = {
  title?: string
  userLabel?: string
  groups: NavGroup[]
  topItems?: NavItem[]
  bottomItems?: NavItem[]
  onSignOut?: () => void | Promise<void>
  onOpenCommand?: () => void
  children: ReactNode
}

function NavRow({ item }: { item: NavItem }) {
  const reduce = useReducedMotion()
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => clsx(styles.navItem, isActive && styles.active)}
      onClick={(e) => {
        /* Keep default NavLink nav; visual active state is immediate via CSS :active */
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      }}
    >
      {() => (
        <>
          {item.icon ? (
            <motion.span
              className={styles.navIcon}
              whileHover={reduce ? undefined : { y: -1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 28 }}
            >
              <Icon icon={item.icon} size="sm" />
            </motion.span>
          ) : null}
          <span className={styles.navLabel}>{item.label}</span>
        </>
      )}
    </NavLink>
  )
}

export function NavSection({
  label,
  items,
  defaultOpen = true,
}: {
  label: string
  items: NavItem[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={styles.section}>
      <button
        type="button"
        className={styles.sectionToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{label}</span>
        <Icon
          icon={ChevronDown}
          size="sm"
          className={clsx(styles.sectionChevron, open && styles.sectionChevronOpen)}
        />
      </button>
      {open ? (
        <div className={styles.sectionItems}>
          {items.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function AppShell({
  title = 'RegAnchor',
  userLabel,
  groups,
  topItems = [],
  bottomItems = [],
  onSignOut,
  onOpenCommand,
  children,
}: Props) {
  const [signingOut, setSigningOut] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountStyle, setAccountStyle] = useState<CSSProperties | null>(null)
  const accountBtnRef = useRef<HTMLButtonElement>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { resolved } = useTheme()
  const wordmarkSrc = resolved === 'dark' ? '/wordmark-light.svg' : '/wordmark.svg'
  const initials = (userLabel || 'U').slice(0, 2).toUpperCase()

  async function handleSignOut() {
    if (!onSignOut) return
    setAccountOpen(false)
    setSigningOut(true)
    try {
      await onSignOut()
      startTransition(() => navigate('/login'))
    } finally {
      setSigningOut(false)
    }
  }

  function placeAccountMenu() {
    const btn = accountBtnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const width = 220
    const gap = 8
    const left = Math.min(Math.max(8, Math.round(r.left)), window.innerWidth - width - 8)
    setAccountStyle({
      position: 'fixed',
      left,
      width,
      bottom: Math.round(window.innerHeight - r.top + gap),
      top: 'auto',
    })
  }

  function toggleAccountMenu() {
    if (accountOpen) {
      setAccountOpen(false)
      return
    }
    placeAccountMenu()
    setAccountOpen(true)
  }

  useEffect(() => {
    if (!accountOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (accountBtnRef.current?.contains(t) || accountMenuRef.current?.contains(t)) return
      setAccountOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAccountOpen(false)
    }
    const onReposition = () => placeAccountMenu()
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [accountOpen])

  function go(path: string) {
    setAccountOpen(false)
    startTransition(() => navigate(path))
  }

  return (
    <div className={styles.shell} data-ra-scroll="shell">
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img src={wordmarkSrc} alt="RegAnchor" width={140} height={26} />
          <span className={styles.brandSr}>{title}</span>
        </div>
        <nav className={styles.nav} aria-label="Primary" data-ra-scroll="sidebar">
          {topItems.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
          {groups.map((g) => (
            <NavSection key={g.id} label={g.label} items={g.items} defaultOpen={g.defaultOpen} />
          ))}
          {bottomItems.length ? (
            <div className={styles.bottomNav}>
              {bottomItems.map((item) => (
                <NavRow key={item.to} item={item} />
              ))}
            </div>
          ) : null}
        </nav>
        <div className={styles.userRow}>
          <div className={styles.userMeta}>
            <div className={styles.userAvatar} aria-hidden>
              {initials}
            </div>
            <div className={styles.userLabel}>{userLabel || 'Signed in'}</div>
          </div>
          <button
            ref={accountBtnRef}
            type="button"
            className={styles.signOut}
            aria-label="Account menu"
            aria-expanded={accountOpen}
            disabled={signingOut}
            onClick={toggleAccountMenu}
          >
            <Icon icon={LogOut} size="sm" />
          </button>
        </div>
      </aside>
      <div className={styles.main}>
        <TopChrome onOpenCommand={onOpenCommand} />
        <div className={styles.content}>{children}</div>
      </div>

      {accountOpen && accountStyle
        ? createPortal(
            <div
              ref={accountMenuRef}
              className={styles.accountMenu}
              role="menu"
              aria-label="Account"
              style={accountStyle}
            >
              <div className={styles.accountHeader}>
                <div className={styles.accountAvatar} aria-hidden>
                  {initials}
                </div>
                <div className={styles.accountEmail}>{userLabel || 'Signed in'}</div>
              </div>
              <button type="button" className={styles.accountItem} role="menuitem" onClick={() => go('/organisation')}>
                <Icon icon={UserRound} size="sm" />
                <span>Account</span>
              </button>
              <button type="button" className={styles.accountItem} role="menuitem" onClick={() => go('/settings')}>
                <Icon icon={Settings} size="sm" />
                <span>Preferences</span>
              </button>
              <button type="button" className={styles.accountItem} role="menuitem" onClick={() => go('/api-keys')}>
                <Icon icon={KeyRound} size="sm" />
                <span>API keys</span>
              </button>
              {onSignOut ? (
                <button
                  type="button"
                  className={styles.accountItem}
                  role="menuitem"
                  disabled={signingOut}
                  onClick={() => void handleSignOut()}
                >
                  <Icon icon={LogOut} size="sm" />
                  <span>Log out</span>
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export const defaultNavIcons = {
  home: LayoutGrid,
  registry: Boxes,
  controls: ClipboardList,
  policies: ScrollText,
  integrations: Plug,
  organisation: Building2,
  settings: Settings,
}
