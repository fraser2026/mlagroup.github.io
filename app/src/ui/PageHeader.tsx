import type { ReactNode } from 'react'
import styles from './PageHeader.module.css'

type Props = {
  title: string
  description?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ title, description, actions }: Props) {
  return (
    <header className={styles.wrap}>
      <div className={styles.copy}>
        <h1 className={styles.title}>{title}</h1>
        {description ? <div className={styles.desc}>{description}</div> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  )
}
