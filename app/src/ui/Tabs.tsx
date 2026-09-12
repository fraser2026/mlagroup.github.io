import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import styles from './Tabs.module.css'

export type TabItem = {
  id: string
  label: string
  count?: number
}

type Props = {
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  trailing?: ReactNode
  className?: string
}

export function Tabs({ items, value, onChange, trailing, className }: Props) {
  return (
    <div className={clsx(styles.bar, className)}>
      <div className={styles.tabs} role="tablist" data-ra-noscroll>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={value === item.id}
            className={clsx(styles.tab, value === item.id && styles.active)}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {typeof item.count === 'number' ? <span className={styles.count}>{item.count}</span> : null}
          </button>
        ))}
      </div>
      {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
    </div>
  )
}
