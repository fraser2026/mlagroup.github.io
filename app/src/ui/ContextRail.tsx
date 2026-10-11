import { useEffect, useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown, Moon } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useShellChrome } from './shellChrome'
import { Icon } from './Icon'
import { ThemePicker } from './ThemePicker'
import styles from './ContextRail.module.css'

export type ContextRailItem = {
  id: string
  label: string
}

/** @deprecated Members block removed from the rail; type kept for import stability. */
export type ContextRailMember = {
  email: string
  role?: string
  you?: boolean
}

type Props = {
  items?: ContextRailItem[]
  scrollRootRef?: RefObject<HTMLElement | null>
}

type RecentPage = { path: string; label: string; at: number }

export const RECENT_PAGES_KEY = 'ra.recent-pages.v1'
const RECENT_KEEP = 8
/** Four rows fill the activity box at its resting height without crowding. */
const RECENT_SHOW = 4

function readRecent(): RecentPage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_PAGES_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((r) => r && r.path && r.label) : []
  } catch {
    return []
  }
}

function writeRecent(list: RecentPage[]) {
  try {
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(list))
  } catch {
    /* storage full or disabled */
  }
}

function relativeWhen(at: number, now: number) {
  const mins = Math.floor((now - at) / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return days === 1 ? 'Yesterday' : `${days}d ago`
}

function sectionOffsetTop(scroller: HTMLElement, el: HTMLElement) {
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
}

function pickActiveSection(scroller: HTMLElement, ids: string[]) {
  const anchor = scroller.scrollTop + Math.min(96, scroller.clientHeight * 0.18)
  let current = ids[0] || ''
  for (const id of ids) {
    const el = document.getElementById(id)
    if (!el) continue
    if (sectionOffsetTop(scroller, el) <= anchor) current = id
    else break
  }
  return current
}

export function ContextRail({ items = [], scrollRootRef }: Props) {
  const { railOpen, breadcrumbs, pageTitle } = useShellChrome()
  const reduce = useReducedMotion()
  const { pathname, search } = useLocation()
  const path = pathname + search
  const currentLabel = breadcrumbs.length ? breadcrumbs[breadcrumbs.length - 1].label : pageTitle || ''
  const [recent, setRecent] = useState<RecentPage[]>(() => readRecent())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!currentLabel) return
    setRecent((prev) => {
      const next = [
        { path, label: currentLabel, at: Date.now() },
        ...prev.filter((r) => r.path.split('?')[0] !== pathname),
      ].slice(
        0,
        RECENT_KEEP,
      )
      writeRecent(next)
      return next
    })
  }, [path, pathname, currentLabel])

  useEffect(() => {
    if (!railOpen) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [railOpen, path])

  const recentOthers = recent
    .filter((r, i, all) => {
      const base = r.path.split('?')[0]
      return base !== pathname && all.findIndex((o) => o.path.split('?')[0] === base) === i
    })
    .slice(0, RECENT_SHOW)
  const [active, setActive] = useState(items[0]?.id ?? '')
  const [tocOpen, setTocOpen] = useState(true)
  const lockUntil = useRef(0)
  const idsKey = items.map((i) => i.id).join('|')

  useEffect(() => {
    if (!items.length) return
    const scroller = scrollRootRef?.current
    if (!scroller) return
    const ids = items.map((i) => i.id)
    const sync = () => {
      if (Date.now() < lockUntil.current) return
      const next = pickActiveSection(scroller, ids)
      setActive((prev) => (prev === next ? prev : next))
    }
    sync()
    scroller.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync)
    return () => {
      scroller.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
    }
  }, [idsKey, items, scrollRootRef])

  function jump(id: string) {
    const el = document.getElementById(id)
    const scroller = scrollRootRef?.current
    if (!el || !scroller) return
    setActive(id)
    lockUntil.current = Date.now() + (reduce ? 50 : 500)
    const top = Math.max(0, sectionOffsetTop(scroller, el) - 12)
    scroller.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <AnimatePresence initial={false}>
      {railOpen ? (
        <motion.aside
          key="rail"
          className={styles.rail}
          data-ra-scroll="canvas"
          initial={reduce ? false : { opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? undefined : { opacity: 0, x: 8 }}
          transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
          aria-label="On this page"
        >
          <div className={styles.inner}>
            <div className={styles.headingRow}>
              <button
                type="button"
                className={styles.headingToggle}
                aria-expanded={tocOpen}
                onClick={() => setTocOpen((v) => !v)}
              >
                <span className={styles.heading}>On this page</span>
                <Icon
                  icon={ChevronDown}
                  size="sm"
                  className={`${styles.headingChevron} ${tocOpen ? styles.headingChevronOpen : ''}`}
                />
              </button>
            </div>

            {tocOpen && items.length ? (
              <nav className={styles.nav} aria-label="Page sections">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.link} ${active === item.id ? styles.active : ''}`}
                    onClick={() => jump(item.id)}
                    aria-current={active === item.id ? 'true' : undefined}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            ) : null}

            <div className={styles.block}>
              <div className={styles.blockHeading}>Recent activity</div>
              {recentOthers.length ? (
                <ul className={styles.recentList}>
                  {recentOthers.map((r) => (
                    <li key={r.path}>
                      <Link className={styles.recentRow} to={r.path} title={r.label}>
                        <span className={styles.recentLabel}>{r.label}</span>
                        <span className={styles.recentWhen}>{relativeWhen(r.at, now)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.activityEmpty}>No recent pages yet</div>
              )}
            </div>

            <div className={styles.appearance}>
              <div className={styles.blockHeading}>
                <Icon icon={Moon} size="sm" className={styles.blockIcon} />
                <span>Appearance</span>
              </div>
              <ThemePicker compact />
            </div>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}
