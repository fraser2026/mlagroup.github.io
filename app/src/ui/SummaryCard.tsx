import type { ReactNode } from 'react'
import styles from './SummaryCard.module.css'

type Props = {
  title: string
  value: ReactNode
  children?: ReactNode
}

export function SummaryCard({ title, value, children }: Props) {
  return (
    <div className={styles.card}>
      <div className={styles.title}>{title}</div>
      <div className={styles.value}>{value}</div>
      {children ? <div className={styles.body}>{children}</div> : null}
    </div>
  )
}

type StatProps = {
  label: string
  value: ReactNode
  hint?: string
}

export function Stat({ label, value, hint }: StatProps) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {hint ? <div className={styles.statHint}>{hint}</div> : null}
    </div>
  )
}
