import type { ReactNode } from 'react'
import styles from './Ledger.module.css'

type LedgerProps = {
  children: ReactNode
  headers?: string[]
  /** Flat detail lists — no card box, flush to the page content edge. */
  flush?: boolean
}

export function Ledger({ children, headers, flush = false }: LedgerProps) {
  return (
    <div className={flush ? `${styles.wrap} ${styles.flush}` : styles.wrap}>
      {headers?.length ? (
        <div className={styles.head} style={{ gridTemplateColumns: `minmax(0,1.4fr) repeat(${Math.max(headers.length - 1, 1)}, minmax(72px, 1fr))` }}>
          {headers.map((h) => (
            <div key={h} className={styles.headCell}>
              {h}
            </div>
          ))}
        </div>
      ) : null}
      <div className={styles.body}>{children}</div>
    </div>
  )
}

type RowProps = {
  title: ReactNode
  description?: string
  meta?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
}

export function LedgerRow({ title, description, meta, trailing, onClick }: RowProps) {
  if (onClick) {
    return (
      <button type="button" className={styles.row} onClick={onClick}>
        <div className={styles.main}>
          <div className={styles.title}>{title}</div>
          {description ? <div className={styles.desc}>{description}</div> : null}
        </div>
        {meta ? <div className={styles.meta}>{meta}</div> : null}
        {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
      </button>
    )
  }
  return (
    <div className={styles.row}>
      <div className={styles.main}>
        <div className={styles.title}>{title}</div>
        {description ? <div className={styles.desc}>{description}</div> : null}
      </div>
      {meta ? <div className={styles.meta}>{meta}</div> : null}
      {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
    </div>
  )
}
