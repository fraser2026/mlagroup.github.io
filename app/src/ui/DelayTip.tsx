import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import styles from './DelayTip.module.css'

type Props = {
  text: string
  children: ReactNode
  className?: string
  /** Hover delay before showing (ms). */
  delayMs?: number
  /**
   * always — chrome / shortcut tips (Search, Copy, …).
   * truncate — only when the child text is clipped (registry descriptions).
   */
  mode?: 'truncate' | 'always'
}

/**
 * RegAnchor hover tip. Suppresses native title tooltips.
 * Long pause by default so tips stay quiet.
 */
export function DelayTip({ text, children, className, delayMs = 650, mode = 'truncate' }: Props) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tipId = useId()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const timerRef = useRef<number | null>(null)

  function clearTimer() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function close() {
    clearTimer()
    setOpen(false)
    setPos(null)
  }

  function isTruncated(el: HTMLElement) {
    return el.scrollWidth > el.clientWidth + 1
  }

  function place() {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const approxW = mode === 'always' ? Math.min(220, Math.max(r.width, 72)) : Math.max(r.width, 180)
    const left = Math.min(r.left, Math.max(12, window.innerWidth - approxW - 12))
    setPos({
      top: r.bottom + 6,
      left,
      width: approxW,
    })
  }

  function onEnter() {
    const el = triggerRef.current
    if (!el || !text.trim()) return
    if (mode === 'truncate' && !isTruncated(el)) return
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      place()
      setOpen(true)
    }, delayMs)
  }

  useEffect(() => () => clearTimer(), [])

  useEffect(() => {
    if (!open) return
    function onScroll() {
      close()
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  return (
    <>
      <span
        ref={triggerRef}
        className={clsx(styles.trigger, mode === 'always' && styles.triggerInline, className)}
        onMouseEnter={onEnter}
        onMouseLeave={close}
        onFocus={onEnter}
        onBlur={close}
        aria-describedby={open ? tipId : undefined}
      >
        {children}
      </span>
      {open && pos
        ? createPortal(
            <div
              id={tipId}
              role="tooltip"
              className={clsx(styles.tip, mode === 'always' && styles.tipCompact)}
              style={{
                top: pos.top,
                left: pos.left,
                width: mode === 'always' ? 'max-content' : Math.min(pos.width, 320),
                maxWidth: 'min(320px, calc(100vw - 24px))',
              }}
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
