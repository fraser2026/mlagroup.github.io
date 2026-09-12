import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { Icon } from './Icon'
import styles from './DateField.module.css'

type Props = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  'aria-label'?: string
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const

function parseISO(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return dt
}

function toISO(dt: Date) {
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatDisplay(value: string) {
  const dt = parseISO(value)
  if (!dt) return ''
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function menuPlacement(trigger: HTMLElement): CSSProperties {
  const r = trigger.getBoundingClientRect()
  const width = Math.max(r.width, 280)
  const spaceBelow = window.innerHeight - r.bottom - 12
  const openUp = spaceBelow < 320 && r.top > spaceBelow
  const left = Math.min(Math.round(r.left), Math.max(12, window.innerWidth - width - 12))
  return {
    left,
    width,
    ...(openUp
      ? { bottom: Math.round(window.innerHeight - r.top + 6), top: 'auto' }
      : { top: Math.round(r.bottom + 6), bottom: 'auto' }),
  }
}

function monthMatrix(view: Date) {
  const y = view.getFullYear()
  const m = view.getMonth()
  const first = new Date(y, m, 1)
  const startPad = (first.getDay() + 6) % 7
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const cells: Array<{ date: Date; inMonth: boolean }> = []
  for (let i = 0; i < startPad; i++) {
    const d = new Date(y, m, 1 - (startPad - i))
    cells.push({ date: d, inMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(y, m, d), inMonth: true })
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false })
  }
  return cells
}

/** RegAnchor date field — SelectMenu-matched trigger + calendar card (no system picker). */
export function DateField({
  value,
  onChange,
  disabled = false,
  placeholder = 'Select date',
  className,
  'aria-label': ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const selected = useMemo(() => parseISO(value), [value])
  const [view, setView] = useState(() => selected || new Date())
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const today = useMemo(() => new Date(), [])
  const label = formatDisplay(value)
  const cells = useMemo(() => monthMatrix(view), [view])
  const monthLabel = view.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  function close() {
    setOpen(false)
    setMenuStyle(null)
  }

  function openMenu() {
    const trigger = rootRef.current
    if (!trigger || disabled) return
    setView(selected || new Date())
    setMenuStyle(menuPlacement(trigger))
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    function place() {
      const trigger = rootRef.current
      if (!trigger) return
      setMenuStyle(menuPlacement(trigger))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
      close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(dt: Date) {
    onChange(toISO(dt))
    close()
  }

  const menu =
    open && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            className={styles.menu}
            role="dialog"
            id={listId}
            aria-label={ariaLabel || 'Choose date'}
            style={menuStyle}
          >
            <div className={styles.head}>
              <button
                type="button"
                className={styles.navBtn}
                aria-label="Previous month"
                onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              >
                <Icon icon={ChevronLeft} size="sm" />
              </button>
              <div className={styles.month}>{monthLabel}</div>
              <button
                type="button"
                className={styles.navBtn}
                aria-label="Next month"
                onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              >
                <Icon icon={ChevronRight} size="sm" />
              </button>
            </div>
            <div className={styles.weekdays} aria-hidden>
              {WEEKDAYS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className={styles.grid} role="grid">
              {cells.map(({ date, inMonth }) => {
                const iso = toISO(date)
                const isSelected = selected ? sameDay(date, selected) : false
                const isToday = sameDay(date, today)
                return (
                  <button
                    key={iso + (inMonth ? '' : '-pad')}
                    type="button"
                    role="gridcell"
                    aria-selected={isSelected}
                    className={clsx(
                      styles.day,
                      !inMonth && styles.dayMuted,
                      isToday && styles.dayToday,
                      isSelected && styles.daySelected,
                    )}
                    onClick={() => pick(date)}
                  >
                    {date.getDate()}
                  </button>
                )
              })}
            </div>
            <div className={styles.foot}>
              <button
                type="button"
                className={styles.footBtn}
                onClick={() => {
                  onChange('')
                  close()
                }}
              >
                Clear
              </button>
              <button
                type="button"
                className={styles.footBtn}
                onClick={() => {
                  const now = new Date()
                  onChange(toISO(now))
                  close()
                }}
              >
                Today
              </button>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div className={clsx(styles.root, className)} ref={rootRef}>
      <button
        type="button"
        className={clsx(styles.trigger, open && styles.triggerOpen, disabled && styles.triggerDisabled)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel || 'Due date'}
        onClick={() => {
          if (disabled) return
          if (open) close()
          else openMenu()
        }}
      >
        <span className={clsx(styles.triggerLabel, !label && styles.placeholder)}>{label || placeholder}</span>
        <Icon icon={Calendar} size="sm" className={styles.chevron} />
      </button>
      {menu}
    </div>
  )
}
