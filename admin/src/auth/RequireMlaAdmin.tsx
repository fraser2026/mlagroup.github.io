import { Navigate } from 'react-router-dom'
import { BrandLoader, Notice, PageHeader } from '@ra/ui'
import { useMlaAuth } from './MlaAuthProvider'
import styles from './LoginPage.module.css'

export function RequireMlaAdmin({ children }: { children: React.ReactNode }) {
  const { ready, session, profile, isMlaAdmin } = useMlaAuth()

  if (!ready) return <BrandLoader viewport label="Loading Control Centre" />
  if (!session) return <Navigate to="/login" replace />

  if (!isMlaAdmin) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <PageHeader title="Control Centre" description="MLA methodology workstation." />
          <Notice tone="risk">
            This surface is limited to MLA admins
            {profile?.email ? ` (${profile.email})` : ''}. Your profile role is not mla_admin.
          </Notice>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
