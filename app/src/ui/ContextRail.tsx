import { useEffect, useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown, Moon, UserPlus, Users } from 'lucide-react'
import { useShellChrome } from './shellChrome'
import { Icon } from './Icon'
import { ThemePicker } from './ThemePicker'
import styles from './ContextRail.module.css'

export type ContextRailItem = {
  id: string
  label: string
}

export type ContextRailMember = {
  email: string
  role?: string
  you?: boolean
}

type Props = {
  items?: ContextRailItem[]
  members?: ContextRailMember[]
  scrollRootRef?: RefObject<HTMLElement | null>
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

export function ContextRail({ items = [], members = [], scrollRootRef }: Props) {
  const { railOpen } = useShellChrome()
  const reduce = useReducedMotion()
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
              <div className={styles.blockHeading}>
                <Icon icon={UserPlus} size="sm" className={styles.blockIcon} />
                <span>Members</span>
              </div>
              <div className={styles.memberCard}>
                {members.length === 0 ? (
                  <div className={styles.muted}>No members loaded.</div>
                ) : (
                  members.map((m) => (
                    <div key={m.email} className={styles.memberRow}>
                      <div className={styles.avatar} aria-hidden>
                        {m.email.slice(0, 2).toUpperCase()}
                      </div>
                      <div className={styles.memberMeta}>
                        <div className={styles.memberEmail}>
                          {m.email}
                          {m.you ? <span className={styles.you}> (you)</span> : null}
                        </div>
                        {m.role ? <div className={styles.memberRole}>{m.role}</div> : null}
                      </div>
                    </div>
                  ))
                )}
                <button type="button" className={styles.viewMembers} disabled>
                  <Icon icon={Users} size="sm" />
                  View {Math.max(members.length, 1)} member{members.length === 1 ? '' : 's'}
                </button>
              </div>
            </div>

            <div className={styles.block}>
              <div className={styles.blockHeading}>Recent activity</div>
              <div className={styles.activityEmpty}>No activity yet</div>
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
