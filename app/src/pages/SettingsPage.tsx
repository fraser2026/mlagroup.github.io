import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Button,
  Notice,
  PageFrame,
  PageHeader,
  StatusLabel,
  ThemePicker,
  ToastStack,
} from '../ui'
import type { ToastItem } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { sb } from '../lib/supabase'
import { MEMBER_ROLE_LABELS } from '../lib/stripe'
import styles from './SettingsPage.module.css'

export function SettingsPage() {
  const { user, profile, org, role, refreshOrg, signOut } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [department, setDepartment] = useState('')
  const [workPhone, setWorkPhone] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [profileError, setProfileError] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)
  const [signOutBusy, setSignOutBusy] = useState(false)

  function pushToast(text: string) {
    if (!text.trim()) return
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts((prev) => [...prev, { id, text }])
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  usePageChrome({
    title: 'Settings',
    breadcrumbs: [{ label: 'Settings' }],
  })

  useEffect(() => {
    setFullName(String(profile?.full_name || '').trim())
    setJobTitle(String(profile?.job_title || '').trim())
    setDepartment(String(profile?.department || '').trim())
    setWorkPhone(String(profile?.work_phone || '').trim())
  }, [profile])

  async function saveProfile() {
    if (!user?.id) return
    setSaving(true)
    setProfileError('')
    try {
      const { error } = await sb.from('profiles').upsert(
        {
          id: user.id,
          full_name: fullName.trim() || null,
          job_title: jobTitle.trim() || null,
          department: department.trim() || null,
          work_phone: workPhone.trim() || null,
        },
        { onConflict: 'id' },
      )
      if (error) throw error
      await refreshOrg()
      pushToast('Profile saved.')
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : 'Could not save profile.')
    } finally {
      setSaving(false)
    }
  }

  async function changePassword() {
    setPwMsg('')
    if (pw.length < 8) {
      setPwMsg('Use at least 8 characters.')
      return
    }
    if (pw !== pw2) {
      setPwMsg('Passwords do not match.')
      return
    }
    setPwBusy(true)
    try {
      const { error } = await sb.auth.updateUser({ password: pw })
      if (error) {
        setPwMsg(error.message)
        return
      }
      pushToast('Password updated.')
      setPw('')
      setPw2('')
    } finally {
      setPwBusy(false)
    }
  }

  async function handleSignOut() {
    setSignOutBusy(true)
    try {
      await signOut()
      navigate('/login', { replace: true })
    } finally {
      setSignOutBusy(false)
    }
  }

  const roleKey = String(role || 'viewer')
  const roleLabel = MEMBER_ROLE_LABELS[roleKey] || roleKey
  const isWorkspaceAdmin = roleKey === 'owner' || roleKey === 'admin'
  const workspaceName = org?.name?.trim() || 'this workspace'

  return (
    <PageFrame
      railItems={[
        { id: 'profile', label: 'Profile' },
        { id: 'access', label: 'Access' },
        { id: 'appearance', label: 'Appearance' },
        { id: 'password', label: 'Password' },
        { id: 'session', label: 'Session' },
      ]}
    >
      <PageHeader
        title="Settings"
        description="Your profile, appearance, and sign-in security for RegAnchor."
      />

      <section id="profile" className={styles.block} aria-labelledby="settings-profile-title">
        <div className={styles.blockCopy}>
          <h2 id="settings-profile-title" className={styles.blockTitle}>
            Your details
          </h2>
          <p className={styles.blockDesc}>
            Shown in Users and when you are assigned as a Business, Compliance, or Technical owner on
            an AI asset. Contact details stay in the app and are omitted from dossier exports.
          </p>
        </div>
        <div className={styles.blockBody}>
          <div className={styles.accountRow}>
            <div>
              <div className={styles.accountLabel}>Signed in as</div>
              <div className={styles.accountValue}>{user?.email || '—'}</div>
            </div>
            <StatusLabel tone="ok">Active</StatusLabel>
          </div>

          <div className={styles.fields}>
            <label className={styles.field}>
              <span className={styles.label}>Full name</span>
              <input
                className={styles.input}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                placeholder="Jane Smith"
              />
            </label>

            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Job title</span>
                <input
                  className={styles.input}
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  autoComplete="organization-title"
                  placeholder="Head of Compliance"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Department</span>
                <input
                  className={styles.input}
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  autoComplete="organization"
                  placeholder="Risk and Compliance"
                />
              </label>
            </div>

            <label className={styles.field}>
              <span className={styles.label}>Work phone</span>
              <input
                className={styles.input}
                value={workPhone}
                onChange={(e) => setWorkPhone(e.target.value)}
                autoComplete="tel"
                inputMode="tel"
                placeholder="+44 20 0000 0000"
              />
            </label>
          </div>

          <div className={styles.actions}>
            <Button size="sm" pending={saving} onClick={() => void saveProfile()}>
              Save profile
            </Button>
          </div>
          {profileError ? (
            <Notice tone="risk" title="Could not save">
              {profileError}
            </Notice>
          ) : null}
        </div>
      </section>

      <section id="access" className={styles.block} aria-labelledby="settings-access-title">
        <div className={styles.blockCopy}>
          <h2 id="settings-access-title" className={styles.blockTitle}>
            Workspace access
          </h2>
          <p className={styles.blockDesc}>
            Your role controls who can invite people and change records. It is separate from Business,
            Compliance, and Technical ownership on individual assets.
          </p>
        </div>
        <div className={styles.blockBody}>
          <div className={styles.statusRow}>
            <StatusLabel tone={isWorkspaceAdmin ? 'ok' : 'neutral'}>{roleLabel}</StatusLabel>
            <p className={styles.statusCopy}>Access level for {workspaceName}.</p>
          </div>
          {isWorkspaceAdmin ? (
            <div className={styles.actions}>
              <Link to="/users">
                <Button size="sm" variant="ghost">
                  Manage users
                </Button>
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      <section id="appearance" className={styles.block} aria-labelledby="settings-appearance-title">
        <div className={styles.blockCopy}>
          <h2 id="settings-appearance-title" className={styles.blockTitle}>
            Appearance
          </h2>
          <p className={styles.blockDesc}>Choose light, dark, or match your system setting.</p>
        </div>
        <div className={styles.blockBody}>
          <ThemePicker />
        </div>
      </section>

      <section id="password" className={styles.block} aria-labelledby="settings-password-title">
        <div className={styles.blockCopy}>
          <h2 id="settings-password-title" className={styles.blockTitle}>
            Password
          </h2>
          <p className={styles.blockDesc}>Update the password used to sign in to your account.</p>
        </div>
        <div className={styles.blockBody}>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.label}>New password</span>
              <input
                type="password"
                className={styles.input}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Confirm password</span>
              <input
                type="password"
                className={styles.input}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                autoComplete="new-password"
              />
            </label>
          </div>
          <div className={styles.actions}>
            <Button size="sm" pending={pwBusy} onClick={() => void changePassword()}>
              Update password
            </Button>
          </div>
          {pwMsg ? <p className={styles.errMsg}>{pwMsg}</p> : null}
        </div>
      </section>

      <section id="session" className={styles.block} aria-labelledby="settings-session-title">
        <div className={styles.blockCopy}>
          <h2 id="settings-session-title" className={styles.blockTitle}>
            Session
          </h2>
          <p className={styles.blockDesc}>Sign out of RegAnchor on this device.</p>
        </div>
        <div className={styles.blockBody}>
          <Button size="sm" variant="ghost" pending={signOutBusy} onClick={() => void handleSignOut()}>
            Sign out
          </Button>
        </div>
      </section>

      <ToastStack items={toasts} onDismiss={dismissToast} />
    </PageFrame>
  )
}
