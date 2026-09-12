import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

type EmptyProps = {
  title: string
  body?: string
  action?: ReactNode
}

export function EmptyState({ title, body, action }: EmptyProps) {
  return (
    <div className={styles.empty}>
      <div className={styles.title}>{title}</div>
      {body ? <div className={styles.body}>{body}</div> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}

type NoticeProps = {
  title?: string
  children: ReactNode
  tone?: 'quiet' | 'warn' | 'risk'
}

export function Notice({ title, children, tone = 'quiet' }: NoticeProps) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`}>
      {title ? <div className={styles.noticeTitle}>{title}</div> : null}
      <div className={styles.noticeBody}>{children}</div>
    </div>
  )
}
