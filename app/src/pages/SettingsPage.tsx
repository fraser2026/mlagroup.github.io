import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Notice,
  PageFrame,
  PageHeader,
  Section,
  StatusLabel,
  ThemePicker,
  ToastStack,
} from '../ui'
import type { ToastItem } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { sb } from '../lib/supabase'
import styles from './SettingsPage.module.css'

export function SettingsPage() {
  const { user, profile, org, refreshOrg, signOut } = useAuth()
  const navigate = useNavigate()
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [organisation, setOrganisation] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [department, setDepartment] = useState('')
  const [workPhone, setWorkPhone] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [profileError, setProfileError] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwTone, setPwTone] = useState<'ok' | 'risk'>('ok')
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
    const full = profile?.full_name || ''
    const parts = full.trim().split(/\s+/)
    setFirst(parts[0] || '')
    setLast(parts.slice(1).join(' ') || '')
    setOrganisation(profile?.organisation || org?.name || '')
    setJobTitle(profile?.job_title || '')
    setDepartment(profile?.department || '')
    setWorkPhone(profile?.work_phone || '')
  }, [profile, org?.name])

  async function saveProfile() {
    if (!user?.id) return
    setSaving(true)
    setProfileError('')
    const full = `${first.trim()} ${last.trim()}`.trim()
    const orgName = organisation.trim()
    try {
      const { error } = await sb.from('profiles').upsert(
        {
          id: user.id,
          full_name: full,
          organisation: orgName,
          job_title: jobTitle.trim() || null,
          department: department.trim() || null,
          work_phone: workPhone.trim() || null,
        },
        { onConflict: 'id' },
      )
      if (error) throw error
      if (org?.id && orgName && orgName !== org.name) {
        await sb.from('organisations').update({ name: orgName }).eq('id', org.id)
      }
      await refreshOrg()
      pushToast('Profile saved.')
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : 'Error saving.')
    } finally {
      setSaving(false)
    }
  }

  async function changePassword() {
    setPwMsg('')
    if (pw.length < 8) {
      setPwTone('risk')
      setPwMsg('Min. 8 characters.')
      return
    }
    if (pw !== pw2) {
      setPwTone('risk')
      setPwMsg('Passwords do not match.')
      return
    }
    setPwBusy(true)
    try {
      const { error } = await sb.auth.updateUser({ password: pw })
      if (error) {
        setPwTone('risk')
        setPwMsg(error.message)
        return
      }
      setPwTone('ok')
      pushToast('Password updated.')
      setPwMsg('')
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

  return (
    <PageFrame
      railItems={[
        { id: 'appearance', label: 'Appearance' },
        { id: 'profile', label: 'Profile' },
        { id: 'password', label: 'Password' },
        { id: 'session', label: 'Session' },
      ]}
    >
      <PageHeader title="Settings" description="Account profile and security for this workspace." />

      <Section id="appearance" title="Appearance" description="Light is the default. System follows your device when selected.">
        <ThemePicker />
        <p className={styles.hint}>Dark mode is tuned for Registry density first. Soft greys keep secondary text readable without going pure white on every label.</p>
      </Section>

      <Section
        id="profile"
        title="Profile"
        description="Your details appear in Users and when you are assigned as an AI asset owner. Contact details stay in the app and are omitted from dossier exports."
      >
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Signed in as</div>
            <div className={styles.value}>{user?.email || '—'}</div>
          </div>
          <StatusLabel tone="ok">Active</StatusLabel>
        </div>
        <div className={styles.form}>
          <label className={styles.field}>
            First name
            <input className={styles.input} value={first} onChange={(e) => setFirst(e.target.value)} />
          </label>
          <label className={styles.field}>
            Last name
            <input className={styles.input} value={last} onChange={(e) => setLast(e.target.value)} />
          </label>
          <label className={styles.fieldWide}>
            Organisation
            <input
              className={styles.input}
              value={organisation}
              onChange={(e) => setOrganisation(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            Job title
            <input
              className={styles.input}
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Head of Risk"
            />
          </label>
          <label className={styles.field}>
            Department
            <input
              className={styles.input}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. Compliance"
            />
          </label>
          <label className={styles.fieldWide}>
            Work email
            <input className={styles.input} value={user?.email || ''} disabled readOnly />
          </label>
          <label className={styles.fieldWide}>
            Work phone
            <input
              className={styles.input}
              value={workPhone}
              onChange={(e) => setWorkPhone(e.target.value)}
              placeholder="e.g. +44 20 0000 0000"
              autoComplete="tel"
            />
          </label>
        </div>
        <div className={styles.actions}>
          <Button pending={saving} onClick={() => void saveProfile()}>
            Save profile
          </Button>
        </div>
        {profileError ? <Notice tone="risk">{profileError}</Notice> : null}
      </Section>

      <Section id="password" title="Password">
        <div className={styles.form}>
          <label className={styles.field}>
            New password
            <input
              type="password"
              className={styles.input}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className={styles.field}>
            Confirm password
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
          <Button pending={pwBusy} onClick={() => void changePassword()}>
            Update password
          </Button>
        </div>
        {pwMsg ? (
          <p className={pwTone === 'ok' ? styles.okMsg : styles.errMsg}>{pwMsg}</p>
        ) : null}
      </Section>

      <Section id="session" title="Session">
        <p className={styles.hint}>Sign out of RegAnchor on this device.</p>
        <Button variant="ghost" pending={signOutBusy} onClick={() => void handleSignOut()}>
          Sign out
        </Button>
      </Section>

      <ToastStack items={toasts} onDismiss={dismissToast} />
    </PageFrame>
  )
}
