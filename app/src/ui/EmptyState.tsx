import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { CircleAlert, Inbox, Info, TriangleAlert } from 'lucide-react'
import { Icon } from './Icon'
import styles from './EmptyState.module.css'

type EmptyProps = {
  title: string
  body?: string
  action?: ReactNode
  icon?: LucideIcon
}

export function EmptyState({ title, body, action, icon = Inbox }: EmptyProps) {
  return (
    <div className={styles.empty}>
      <span className={styles.glyph}>
        <Icon icon={icon} size="sm" />
      </span>
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
  icon?: LucideIcon
}

const TONE_ICON = { quiet: Info, warn: TriangleAlert, risk: CircleAlert } as const

export function Notice({ title, children, tone = 'quiet', icon }: NoticeProps) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`}>
      <Icon icon={icon ?? TONE_ICON[tone]} size="sm" className={styles.noticeIcon} />
      <div>
        {title ? <div className={styles.noticeTitle}>{title}</div> : null}
        <div className={styles.noticeBody}>{children}</div>
      </div>
    </div>
  )
}
