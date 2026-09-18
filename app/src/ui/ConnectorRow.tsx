import type { ReactNode } from 'react'
import styles from './ConnectorRow.module.css'
import { StatusLabel, type StatusTone } from './StatusLabel'

type Props = {
  icon?: ReactNode
  name: string
  status: string
  statusTone?: StatusTone
  tags?: string[]
  actions?: ReactNode
}

export function ConnectorRow({ icon, name, status, statusTone = 'ok', tags = [], actions }: Props) {
  return (
    <div className={styles.row}>
      {icon ? (
        <div className={styles.icon} aria-hidden>
          {icon}
        </div>
      ) : null}
      <div className={styles.main}>
        <div className={styles.nameRow}>
          <span className={styles.name}>{name}</span>
          <StatusLabel tone={statusTone}>{status}</StatusLabel>
        </div>
        {tags.length ? (
          <div className={styles.tags}>
            {tags.map((t) => (
              <span key={t} className={styles.tag}>
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  )
}
