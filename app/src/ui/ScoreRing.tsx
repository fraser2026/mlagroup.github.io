import { clsx } from 'clsx'
import styles from './ScoreRing.module.css'

type Props = {
  value: number
  size?: number
  label?: string
  sublabel?: string
  className?: string
}

export function ScoreRing({ value, size = 148, label, sublabel, className }: Props) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c - (v / 100) * c

  return (
    <div className={clsx(styles.wrap, className)} style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className={styles.track} cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className={styles.fill}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className={styles.center}>
        <div className={styles.value}>{v}</div>
        {label ? <div className={styles.label}>{label}</div> : null}
        {sublabel ? <div className={styles.sub}>{sublabel}</div> : null}
      </div>
    </div>
  )
}
