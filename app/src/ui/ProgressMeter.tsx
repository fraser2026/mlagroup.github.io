import { clsx } from 'clsx'
import styles from './ProgressMeter.module.css'

type Props = {
  value: number
  label?: string
  size?: 'sm' | 'md'
  bare?: boolean
  className?: string
}

export function ProgressMeter({ value, label, size = 'md', bare = false, className }: Props) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className={clsx(styles.wrap, size === 'sm' && styles.sm, className)}>
      {!bare ? (
        <div className={styles.top}>
          {label ? <span className={styles.label}>{label}</span> : <span />}
          <span className={styles.value}>{v}%</span>
        </div>
      ) : null}
      <div className={styles.track} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <span className={styles.fill} style={{ width: `${v}%` }} />
      </div>
    </div>
  )
}
