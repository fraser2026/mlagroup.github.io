import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { Check } from 'lucide-react'
import { Icon } from './Icon'
import styles from './Checklist.module.css'

export type ChecklistItem = {
  id: string
  title: string
  body?: string
  done: boolean
  action?: ReactNode
  required?: boolean
}

type Props = {
  items: ChecklistItem[]
  className?: string
}

export function Checklist({ items, className }: Props) {
  return (
    <ol className={clsx(styles.list, className)}>
      {items.map((item, i) => (
        <li key={item.id} className={clsx(styles.row, item.done && styles.done)}>
          <div className={styles.marker} aria-hidden>
            {item.done ? <Icon icon={Check} size="sm" /> : <span className={styles.num}>{i + 1}</span>}
          </div>
          <div className={styles.body}>
            <div className={styles.title}>
              {item.title}
              {item.required && !item.done ? <span className={styles.req}>Required</span> : null}
            </div>
            {item.body ? <div className={styles.desc}>{item.body}</div> : null}
          </div>
          {item.action ? <div className={styles.action}>{item.action}</div> : null}
        </li>
      ))}
    </ol>
  )
}
