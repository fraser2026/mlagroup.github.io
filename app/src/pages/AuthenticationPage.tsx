import { useCallback, useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import {
  BrandLoader,
  Button,
  Drawer,
  Icon,
  Notice,
  PageFrame,
  PageHeader,
  ToastStack,
} from '../ui'
import type { ToastItem } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { sb } from '../lib/supabase'
import styles from './AuthenticationPage.module.css'

type TotpFactor = {
  id: string
  friendly_name?: string
  status: string
}

function formatSecret(secret: string) {
  return secret.replace(/(.{4})/g, '$1 ').trim()
}

export function AuthenticationPage() {
  const [loading, setLoading] = useState(true)
  const [factors, setFactors] = useState<TotpFactor[]>([])
  const [error, setError] = useState('')
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [factorId, setFactorId] = useState('')
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [enrollBusy, setEnrollBusy] = useState(false)
  const [disableBusy, setDisableBusy] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [hasRecovery, setHasRecovery] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])

  usePageChrome({
    title: 'Authentication',
    breadcrumbs: [{ label: 'Authentication' }],
  })

  function pushToast(text: string) {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}`
    setToasts((prev) => [...prev, { id, text }])
  }

  const refresh = useCallback(async () => {
    setError('')
    const { data, error: listErr } = await sb.auth.mfa.listFactors()
    if (listErr) {
      setError(listErr.message)
      setFactors([])
    } else {
      setFactors((data?.totp || []) as TotpFactor[])
    }
    const { data: userData } = await sb.auth.getUser()
    const uid = userData.user?.id
    if (uid) {
      const { count } = await sb
        .from('user_mfa_recovery_codes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .is('used_at', null)
      setHasRecovery((count || 0) > 0)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        await refresh()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const verified = factors.filter((f) => f.status === 'verified')
  const mfaEnabled = verified.length > 0

  async function startEnroll() {
    setError('')
    setCode('')
    setEnrollBusy(true)
    try {
      // Drop unverified leftovers so enroll can start cleanly.
      for (const f of factors.filter((x) => x.status !== 'verified')) {
        await sb.auth.mfa.unenroll({ factorId: f.id })
      }
      const { data, error: enrollErr } = await sb.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'RegAnchor',
      })
      if (enrollErr || !data) throw enrollErr || new Error('Could not start MFA enrollment.')
      setFactorId(data.id)
      setQr(data.totp.qr_code)
      setSecret(data.totp.secret)
      setEnrollOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start MFA enrollment.')
    } finally {
      setEnrollBusy(false)
    }
  }

  async function cancelEnroll() {
    if (factorId) {
      await sb.auth.mfa.unenroll({ factorId }).catch(() => undefined)
    }
    setEnrollOpen(false)
    setFactorId('')
    setQr('')
    setSecret('')
    setCode('')
    await refresh()
  }

  async function confirmEnroll() {
    const trimmed = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setEnrollBusy(true)
    setError('')
    try {
      const challenge = await sb.auth.mfa.challenge({ factorId })
      if (challenge.error) throw challenge.error
      const verify = await sb.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code: trimmed,
      })
      if (verify.error) throw verify.error
      setEnrollOpen(false)
      setFactorId('')
      setQr('')
      setSecret('')
      setCode('')
      await refresh()
      pushToast('Authenticator app enabled.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify code.')
    } finally {
      setEnrollBusy(false)
    }
  }

  async function disableMfa() {
    if (!window.confirm('Disable authenticator app MFA for your account?')) return
    setDisableBusy(true)
    setError('')
    try {
      for (const f of verified) {
        const { error: unErr } = await sb.auth.mfa.unenroll({ factorId: f.id })
        if (unErr) throw unErr
      }
      await refresh()
      pushToast('Authenticator app disabled.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disable MFA.')
    } finally {
      setDisableBusy(false)
    }
  }

  async function generateRecovery() {
    setRecoveryBusy(true)
    setError('')
    try {
      const { data: userData, error: userErr } = await sb.auth.getUser()
      if (userErr || !userData.user) throw userErr || new Error('Sign in required.')
      const uid = userData.user.id
      const codes: string[] = []
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      for (let i = 0; i < 10; i++) {
        let part = ''
        const bytes = crypto.getRandomValues(new Uint8Array(10))
        for (const b of bytes) part += alphabet[b % alphabet.length]
        codes.push(`${part.slice(0, 5)}-${part.slice(5)}`)
      }
      const rows = await Promise.all(
        codes.map(async (c) => {
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(c))
          const hash = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')
          return { user_id: uid, code_hash: hash }
        }),
      )
      await sb.from('user_mfa_recovery_codes').delete().eq('user_id', uid)
      const { error: insErr } = await sb.from('user_mfa_recovery_codes').insert(rows)
      if (insErr) throw insErr
      setRecoveryCodes(codes)
      setRecoveryOpen(true)
      setHasRecovery(true)
      pushToast('Recovery codes generated. Store them somewhere safe.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate recovery codes.')
    } finally {
      setRecoveryBusy(false)
    }
  }

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title="Authentication"
          description="Settings for how you authenticate when signing in to RegAnchor."
        />
        <BrandLoader fill label="Loading authentication" />
      </PageFrame>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        title="Authentication"
        description="Settings for how you authenticate when signing in to RegAnchor."
      />

      {error && !enrollOpen ? (
        <Notice tone="risk" title="Authentication">
          {error}
        </Notice>
      ) : null}

      <section className={styles.block}>
        <div className={styles.blockCopy}>
          <h2 className={styles.blockTitle}>Multi-factor authentication (MFA)</h2>
          <p className={styles.blockDesc}>
            Add an extra layer of security to your account when signing in.
          </p>
        </div>
        <div className={styles.blockBody}>
          <div className={styles.panel}>
            <div className={styles.panelRow}>
              <div className={styles.panelCopy}>
                <div className={styles.panelTitle}>Authenticator app (TOTP)</div>
                <p className={styles.panelDesc}>
                  Use an authentication code from an authenticator app.
                </p>
              </div>
              {mfaEnabled ? (
                <Button variant="ghost" size="sm" pending={disableBusy} onClick={() => void disableMfa()}>
                  Disable
                </Button>
              ) : (
                <Button size="sm" pending={enrollBusy} onClick={() => void startEnroll()}>
                  Enable
                </Button>
              )}
            </div>

            <div className={styles.panelDivider} />

            <div className={styles.panelRow}>
              <div className={styles.panelCopy}>
                <div className={styles.panelTitle}>Recovery codes</div>
                <p className={styles.panelDesc}>
                  Generate backup codes as an alternative way to get into your account.
                </p>
                {hasRecovery ? (
                  <p className={styles.panelMeta}>Unused recovery codes are stored for your account.</p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                pending={recoveryBusy}
                onClick={() => void generateRecovery()}
              >
                Generate
              </Button>
            </div>
          </div>
        </div>
      </section>

      <Drawer
        open={enrollOpen}
        onClose={() => void cancelEnroll()}
        title="Enable authenticator app"
        description="Connect your preferred authenticator app using the steps below, then enter the 6-digit code that the app provides."
        footer={
          <div className={styles.drawerActions}>
            <Button variant="ghost" size="sm" onClick={() => void cancelEnroll()}>
              Back
            </Button>
            <Button size="sm" pending={enrollBusy} onClick={() => void confirmEnroll()}>
              Confirm
            </Button>
          </div>
        }
      >
        {error && enrollOpen ? (
          <Notice tone="risk" title="Could not verify">
            {error}
          </Notice>
        ) : null}

        <div className={styles.step}>
          <div className={styles.stepLabel}>1. Scan QR code</div>
          {qr ? (
            <div className={styles.qrRow}>
              <div className={styles.qrWrap}>
                <img className={styles.qr} src={qr} alt="Authenticator QR code" />
              </div>
            </div>
          ) : null}
          <p className={styles.stepHint}>or enter the code manually</p>
          {secret ? (
            <div className={styles.secretBar}>
              <code className={styles.manualSecret}>{formatSecret(secret)}</code>
              <button
                type="button"
                className={styles.copyBtn}
                aria-label="Copy secret"
                onClick={() => {
                  void navigator.clipboard.writeText(secret).then(
                    () => pushToast('Secret copied.'),
                    () => pushToast('Could not copy.'),
                  )
                }}
              >
                <Icon icon={Copy} size="sm" />
              </button>
            </div>
          ) : null}
        </div>

        <div className={styles.step}>
          <div className={styles.stepLabel}>2. Enter 6-digit code</div>
          <input
            className={styles.codeInput}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void confirmEnroll()
              }
            }}
          />
        </div>
      </Drawer>

      <Drawer
        open={recoveryOpen}
        onClose={() => {
          setRecoveryOpen(false)
          setRecoveryCodes([])
        }}
        title="Recovery codes"
        description="Copy these codes now. They will not be shown again. Each code can be used once."
        footer={
          <div className={styles.drawerActions}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(recoveryCodes.join('\n'))
                pushToast('Recovery codes copied.')
              }}
            >
              Copy all
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setRecoveryOpen(false)
                setRecoveryCodes([])
              }}
            >
              Done
            </Button>
          </div>
        }
      >
        <ul className={styles.recoveryList}>
          {recoveryCodes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
      </Drawer>

      <ToastStack items={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </PageFrame>
  )
}
