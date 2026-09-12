import type { ReactNode } from 'react'
import styles from './FilterBar.module.css'

type Props = {
  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  children?: ReactNode
}

export function FilterBar({
  search = '',
  onSearchChange,
  searchPlaceholder = 'Search',
  children,
}: Props) {
  return (
    <div className={styles.bar}>
      {onSearchChange ? (
        <input
          className={styles.search}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          type="search"
        />
      ) : null}
      <div className={styles.filters}>{children}</div>
    </div>
  )
}
