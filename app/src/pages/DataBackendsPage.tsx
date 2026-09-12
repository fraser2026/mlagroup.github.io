import { useState } from 'react'
import { BrandIcon } from '../icons/BrandIcon'
import { Button, PageFrame, PageHeader, ToastStack } from '../ui'
import type { ToastItem } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import styles from './DataBackendsPage.module.css'

type Backend = {
  slug: string
  name: string
  description: string
}

const BACKENDS: Backend[] = [
  {
    slug: 'bigquery',
    name: 'BigQuery',
    description: 'Connect a Google BigQuery warehouse.',
  },
  {
    slug: 'snowflake',
    name: 'Snowflake',
    description: 'Connect a Snowflake warehouse.',
  },
  {
    slug: 'databricks',
    name: 'Databricks',
    description: 'Connect a Databricks workspace.',
  },
  {
    slug: 'redshift',
    name: 'Redshift',
    description: 'Connect an Amazon Redshift cluster.',
  },
  {
    slug: 'postgres',
    name: 'Postgres',
    description: 'Connect a PostgreSQL database.',
  },
]

export function DataBackendsPage() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  usePageChrome({
    title: 'Data backends',
    breadcrumbs: [{ label: 'Data backends' }],
  })

  function pushToast(text: string) {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}`
    setToasts((prev) => [...prev, { id, text }])
  }

  return (
    <PageFrame>
      <PageHeader
        title="Data backends"
        description="Connect data warehouses and databases that this project can use for monitoring data."
      />

      <div className={styles.list}>
        {BACKENDS.map((b) => (
          <div key={b.slug} className={styles.row}>
            <div className={styles.main}>
              <span className={styles.icon}>
                <BrandIcon slug={b.slug} size={40} title={b.name} />
              </span>
              <div className={styles.copy}>
                <div className={styles.name}>{b.name}</div>
                <div className={styles.desc}>{b.description}</div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="md"
              onClick={() => pushToast(`${b.name} connect ships in a later release.`)}
            >
              Connect
            </Button>
          </div>
        ))}
      </div>

      <ToastStack items={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </PageFrame>
  )
}
