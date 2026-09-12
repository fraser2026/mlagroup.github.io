import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import styles from './Drawer.module.css'

type Variant = 'modal' | 'preview'

type Props = {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  /** Primary actions - rendered in the footer (portal modal pattern). */
  footer?: ReactNode
  /** @deprecated Prefer footer. Still supported; if set without footer, stays in header. */
  actions?: ReactNode
  /** modal = form overlay with blur; preview = dim inventory card, no blur */
  variant?: Variant
  /** Optional meta row under the title (badges, etc.) */
  headerMeta?: ReactNode
}

export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  actions,
  variant = 'modal',
  headerMeta,
}: Props) {
  const isPreview = variant === 'preview'
  const [mounted, setMounted] = useState(open)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setExiting(false)
      return
    }
    if (!mounted) return
    if (isPreview) {
      setExiting(true)
      const t = window.setTimeout(() => {
        setMounted(false)
        setExiting(false)
      }, 180)
      return () => window.clearTimeout(t)
    }
    setMounted(false)
  }, [open, isPreview, mounted])

  useEffect(() => {
    if (!mounted || exiting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mounted, exiting, onClose])

  if (!mounted) return null

  const footerContent = footer ?? null
  const headerActions = footer ? null : actions

  return (
    <div
      className={clsx(
        styles.overlay,
        isPreview && styles.overlayPreview,
        exiting && styles.overlayExit,
      )}
      role="presentation"
      onClick={() => {
        if (!exiting) onClose()
      }}
    >
      <aside
        className={clsx(
          styles.panel,
          isPreview && styles.panelPreview,
          exiting && styles.panelExit,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={clsx(styles.header, isPreview && styles.headerPreview)}>
          <div className={styles.headerCopy}>
            <h2 className={styles.title}>{title}</h2>
            {headerMeta ? <div className={styles.headerMeta}>{headerMeta}</div> : null}
            {description ? <p className={styles.description}>{description}</p> : null}
          </div>
          <div className={styles.headerActions}>
            {headerActions}
            <button
              type="button"
              className={styles.close}
              onClick={() => {
                if (!exiting) onClose()
              }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>
        <div className={clsx(styles.body, isPreview && styles.bodyPreview)} data-ra-scroll="canvas">
          {children}
        </div>
        {footerContent ? (
          <footer className={clsx(styles.footer, isPreview && styles.footerPreview)}>{footerContent}</footer>
        ) : null}
      </aside>
    </div>
  )
}
