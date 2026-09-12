import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import styles from './StatusLabel.module.css'

export type StatusTone = 'neutral' | 'ok' | 'warn' | 'risk' | 'info'

type Props = {
  children: ReactNode
  tone?: StatusTone
  /** Soft square chip (4px) — Vanta / OpenLayer style, scarce fills */
  badge?: boolean
}

export function StatusLabel({ children, tone = 'neutral', badge = false }: Props) {
  return (
    <span className={clsx(styles.label, styles[tone], badge && styles.badge, badge && styles[`badge_${tone}`])}>
      {children}
    </span>
  )
}
