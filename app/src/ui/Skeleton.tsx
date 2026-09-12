import { clsx } from 'clsx'
import styles from './Skeleton.module.css'

type Props = {
  className?: string
  height?: number | string
  width?: number | string
  radius?: number | string
}

/** Quiet progressive-load placeholder that reserves space. */
export function Skeleton({ className, height = 14, width = '100%', radius = 4 }: Props) {
  return (
    <div
      className={clsx(styles.bone, className)}
      style={{ height, width, borderRadius: radius }}
      aria-hidden
    />
  )
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className={styles.rows}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={40} />
      ))}
    </div>
  )
}
