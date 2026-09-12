import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import styles from './Timeline.module.css'

export type TimelineItem = {
  id: string
  title: string
  meta?: string
  tone?: 'neutral' | 'ok' | 'warn' | 'risk' | 'info'
  trailing?: ReactNode
}

type Props = {
  items: TimelineItem[]
  className?: string
  empty?: ReactNode
}

export function Timeline({ items, className, empty }: Props) {
  if (!items.length) return <>{empty}</>
  return (
    <ol className={clsx(styles.list, className)}>
      {items.map((item) => (
        <li key={item.id} className={styles.row}>
          <span className={clsx(styles.dot, item.tone && styles[item.tone])} aria-hidden />
          <div className={styles.body}>
            <div className={styles.title}>{item.title}</div>
            {item.meta ? <div className={styles.meta}>{item.meta}</div> : null}
          </div>
          {item.trailing ? <div className={styles.trailing}>{item.trailing}</div> : null}
        </li>
      ))}
    </ol>
  )
}
