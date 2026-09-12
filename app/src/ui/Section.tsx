import type { ReactNode } from 'react'
import styles from './Section.module.css'

type Props = {
  id: string
  /** Omit when the tab label already provides the title and content is self-explanatory. */
  title?: string
  description?: string
  children?: ReactNode
  className?: string
}

export function Section({ id, title, description, children, className = '' }: Props) {
  return (
    <section id={id} className={`${styles.section} ${className}`.trim()} data-ra-section={id}>
      {title ? (
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          {description ? <p className={styles.desc}>{description}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  )
}
