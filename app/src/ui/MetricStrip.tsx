import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import styles from './MetricStrip.module.css'

export type Metric = {
  id: string
  label: string
  value: ReactNode
  hint?: string
  tone?: 'default' | 'risk' | 'ok' | 'warn'
}

type Props = {
  items: Metric[]
  className?: string
}

export function MetricStrip({ items, className }: Props) {
  return (
    <div className={clsx(styles.strip, className)}>
      {items.map((m) => (
        <div key={m.id} className={clsx(styles.cell, m.tone && styles[m.tone])}>
          <div className={styles.label}>{m.label}</div>
          <div className={styles.value}>{m.value}</div>
          {m.hint ? <div className={styles.hint}>{m.hint}</div> : null}
        </div>
      ))}
    </div>
  )
}
