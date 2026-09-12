import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import styles from './Toast.module.css'

export type ToastItem = {
  id: string
  text: string
}

type Props = {
  items: ToastItem[]
  onDismiss: (id: string) => void
}

/** Bottom-right ephemeral notices. Short sentence, accent marker, auto-dismiss. */
export function ToastStack({ items, onDismiss }: Props) {
  if (!items.length || typeof document === 'undefined') return null
  return createPortal(
    <div className={styles.stack} aria-live="polite" aria-relevant="additions">
      {items.map((t) => (
        <ToastCard key={t.id} text={t.text} onDone={() => onDismiss(t.id)} />
      ))}
    </div>,
    document.body,
  )
}

function ToastCard({ text, onDone }: { text: string; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const hide = window.setTimeout(() => setLeaving(true), 2500)
    return () => window.clearTimeout(hide)
  }, [])

  useEffect(() => {
    if (!leaving) return
    const done = window.setTimeout(onDone, 180)
    return () => window.clearTimeout(done)
  }, [leaving, onDone])

  return (
    <div className={clsx(styles.toast, leaving && styles.leaving)} role="status">
      <span className={styles.mark} aria-hidden />
      <span className={styles.text}>{text}</span>
    </div>
  )
}
