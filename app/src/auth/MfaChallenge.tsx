import { useState } from 'react'
import { Button, Notice } from '../ui'
import { sb } from '../lib/supabase'
import styles from './MfaChallenge.module.css'

type Props = {
  onVerified: () => void
}

export function MfaChallenge({ onVerified }: Props) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp')

  async function verifyTotp() {
    const trimmed = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const factors = await sb.auth.mfa.listFactors()
      if (factors.error) throw factors.error
      const totp = factors.data.totp.find((f) => f.status === 'verified')
      if (!totp) throw new Error('No authenticator app is enrolled.')
      const challenge = await sb.auth.mfa.challenge({ factorId: totp.id })
      if (challenge.error) throw challenge.error
      const verify = await sb.auth.mfa.verify({
        factorId: totp.id,
        challengeId: challenge.data.id,
        code: trimmed,
      })
      if (verify.error) throw verify.error
      onVerified()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed.')
    } finally {
      setBusy(false)
    }
  }

  async function verifyRecovery() {
    const raw = code.trim().toUpperCase()
    if (!raw) {
      setError('Enter a recovery code.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { data: userData, error: userErr } = await sb.auth.getUser()
      if (userErr || !userData.user) throw userErr || new Error('Sign in required.')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
      const hash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const { data: row, error: findErr } = await sb
        .from('user_mfa_recovery_codes')
        .select('id')
        .eq('user_id', userData.user.id)
        .eq('code_hash', hash)
        .is('used_at', null)
        .maybeSingle()
      if (findErr) throw findErr
      if (!row) throw new Error('Invalid or already used recovery code.')

      const { error: useErr } = await sb
        .from('user_mfa_recovery_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('id', row.id)
      if (useErr) throw useErr

      // Recovery unlocks the session by verifying an enrolled TOTP factor is present,
      // then removing MFA so the user can re-enroll. Prefer verifying via a fresh TOTP
      // when possible; recovery is the break-glass path.
      const factors = await sb.auth.mfa.listFactors()
      if (factors.error) throw factors.error
      for (const f of factors.data.totp) {
        await sb.auth.mfa.unenroll({ factorId: f.id })
      }
      onVerified()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recovery failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.title}>Confirm it is you</h1>
        <p className={styles.desc}>
          {mode === 'totp'
            ? 'Enter the 6-digit code from your authenticator app to continue.'
            : 'Enter one of your unused recovery codes. This disables MFA so you can set it up again.'}
        </p>
        {error ? (
          <Notice tone="risk" title="Could not verify">
            {error}
          </Notice>
        ) : null}
        <label className={styles.field}>
          {mode === 'totp' ? 'Authentication code' : 'Recovery code'}
          <input
            className={styles.input}
            value={code}
            onChange={(e) =>
              setCode(mode === 'totp' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)
            }
            placeholder={mode === 'totp' ? '000000' : 'XXXXX-XXXXX'}
            autoComplete={mode === 'totp' ? 'one-time-code' : 'off'}
            inputMode={mode === 'totp' ? 'numeric' : 'text'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void (mode === 'totp' ? verifyTotp() : verifyRecovery())
              }
            }}
          />
        </label>
        <div className={styles.actions}>
          <Button
            size="sm"
            pending={busy}
            onClick={() => void (mode === 'totp' ? verifyTotp() : verifyRecovery())}
          >
            Continue
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMode(mode === 'totp' ? 'recovery' : 'totp')
              setCode('')
              setError('')
            }}
          >
            {mode === 'totp' ? 'Use a recovery code' : 'Use authenticator app'}
          </Button>
        </div>
      </div>
    </div>
  )
}
