import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { Button, Notice, SelectMenu, StatusLabel } from '../ui'
import { BrandIcon } from '../icons/BrandIcon'
import { invokeEdge } from '../lib/edge'
import {
  DEFAULT_BEDROCK_REGION,
  fmtAccountId,
  parseRoleArn,
  REGION_OPTIONS,
  roleArnHint,
  type AwsAccount,
  type AwsSetup,
} from '../lib/aws'
import page from './RegistryDetailPage.module.css'
import styles from './BedrockConnection.module.css'

type Props = {
  orgId: string
  /** When set, the new account is also linked to this asset. */
  assetId?: string
  /** A setup this user started earlier and has not finished. */
  pending?: AwsAccount | null
  accessToken?: string
  onConnected: (account: AwsAccount) => Promise<void> | void
  onCancel?: () => void
  onToast: (text: string) => void
}

type Prepared = AwsSetup & { account: string; region: string; external_id: string; connection_ref: string }
type StepError = { at: 'launch' | 'verify' | 'key'; text: string } | null

/** Connects an AWS account for the organisation: CloudFormation role (recommended) or a Bedrock API key. */
export function AwsAccountSetup({ orgId, assetId, pending, accessToken, onConnected, onCancel, onToast }: Props) {
  const [mode, setMode] = useState<'role' | 'key'>('role')
  const [region, setRegion] = useState(pending?.home_region || DEFAULT_BEDROCK_REGION)
  const [label, setLabel] = useState(pending?.label || '')
  const [setup, setSetup] = useState<Prepared | null>(null)
  const [roleArn, setRoleArn] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState('')
  const [stepError, setStepError] = useState<StepError>(null)
  const [copied, setCopied] = useState('')

  const parsedArn = roleArn.trim() ? parseRoleArn(roleArn) : null
  const expectedRef = setup?.connection_ref || pending?.connection_ref || null
  const arnMismatch = !!parsedArn && !!expectedRef && parsedArn.connectionRef !== expectedRef

  async function call<T>(body: Record<string, unknown>): Promise<T> {
    if (!accessToken) throw new Error('Sign in again to continue.')
    return invokeEdge<T>('aws-connect', { org_id: orgId, ...(assetId ? { asset_id: assetId } : {}), ...body }, accessToken)
  }

  async function prepare(regionCode: string) {
    const res = await call<{ account: AwsAccount; setup: AwsSetup }>({
      action: 'prepare',
      region: regionCode,
      label: label.trim(),
      ...(setup?.account || pending?.id ? { account: setup?.account || pending?.id } : {}),
    })
    const next: Prepared = {
      ...res.setup,
      account: res.account.id,
      region: regionCode,
      external_id: res.account.external_id,
      connection_ref: res.account.connection_ref,
    }
    setSetup(next)
    return next
  }

  // Returning to a setup already started: restore the launch details without creating anything new.
  useEffect(() => {
    if (!pending || setup?.region === region) return
    prepare(region).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.id, region])

  async function currentSetup() {
    return setup && setup.region === region ? setup : prepare(region)
  }

  async function launch() {
    setStepError(null)
    const tab = window.open('about:blank', '_blank')
    setBusy('launch')
    try {
      const s = await currentSetup()
      if (tab) {
        tab.opener = null
        tab.location.href = s.launch_url
      } else {
        window.open(s.launch_url, '_blank', 'noopener')
      }
    } catch (e) {
      tab?.close()
      setStepError({ at: 'launch', text: e instanceof Error ? e.message : 'Could not start the AWS setup.' })
    } finally {
      setBusy('')
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      window.setTimeout(() => setCopied((c) => (c === what ? '' : c)), 1600)
    } catch {
      onToast('Could not copy. Select the text and copy it manually.')
    }
  }

  async function copySetupLink() {
    setStepError(null)
    setBusy('link')
    try {
      const s = await currentSetup()
      await copy(s.launch_url, 'link')
      onToast('Setup link copied. Whoever opens it must be signed in to the AWS account being connected.')
    } catch (e) {
      setStepError({ at: 'launch', text: e instanceof Error ? e.message : 'Could not create the setup link.' })
    } finally {
      setBusy('')
    }
  }

  async function verifyRole() {
    setStepError(null)
    setBusy('verify')
    try {
      const s = await currentSetup()
      const res = await call<{ account: AwsAccount }>({
        action: 'verify_role',
        account: s.account,
        role_arn: roleArn.trim(),
        label: label.trim(),
      })
      setRoleArn('')
      setSetup(null)
      await onConnected(res.account)
    } catch (e) {
      setStepError({ at: 'verify', text: e instanceof Error ? e.message : 'Could not verify the role.' })
    } finally {
      setBusy('')
    }
  }

  async function connectKey() {
    setStepError(null)
    setBusy('key')
    try {
      const res = await call<{ account: AwsAccount }>({
        action: 'connect_key',
        region,
        label: label.trim(),
        api_key: apiKey.trim(),
      })
      setApiKey('')
      await onConnected(res.account)
    } catch (e) {
      setStepError({ at: 'key', text: e instanceof Error ? e.message : 'Could not verify the key.' })
    } finally {
      setBusy('')
    }
  }

  const errorFor = (at: NonNullable<StepError>['at']) =>
    stepError?.at === at ? <Notice tone="risk">{stepError.text}</Notice> : null

  const nameField = (
    <label className={page.fieldBlock}>
      <span className={styles.label}>Name (optional)</span>
      <input
        className={clsx(page.input, styles.name)}
        type="text"
        maxLength={60}
        autoComplete="off"
        placeholder="For example Production, or a supplier's name"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
    </label>
  )

  const cancel = onCancel ? (
    <button type="button" className={styles.linkBtn} onClick={onCancel}>
      Cancel
    </button>
  ) : null

  if (mode === 'key') {
    return (
      <>
        <div className={page.cardBody}>
          <p className={page.connHint}>
            For pilots, or when your team cannot create IAM roles. Create a long-term API key in the Amazon Bedrock
            console under API keys. Short-term keys expire within 12 hours.
          </p>
          {nameField}
          <label className={page.fieldBlock}>
            <span className={styles.label}>Region</span>
            <SelectMenu
              className={styles.region}
              value={region}
              options={REGION_OPTIONS}
              onChange={setRegion}
              aria-label="AWS region"
            />
          </label>
          <label className={page.fieldBlock}>
            <span className={styles.label}>Bedrock API key</span>
            <input
              className={page.secret}
              type="text"
              autoComplete="off"
              spellCheck={false}
              aria-label="Bedrock API key"
              placeholder="Paste the API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <p className={styles.stepHint}>Stored in Vault and never shown again.</p>
          {errorFor('key')}
          <div className={page.actions}>
            <Button size="sm" onClick={() => void connectKey()} pending={busy === 'key'} disabled={apiKey.trim().length < 20}>
              Verify and connect
            </Button>
          </div>
        </div>
        <footer className={clsx(page.cardFoot, styles.foot)}>
          <button type="button" className={styles.linkBtn} onClick={() => { setMode('role'); setStepError(null) }}>
            Use the IAM role instead (recommended)
          </button>
          {cancel}
        </footer>
      </>
    )
  }

  return (
    <>
      <div className={page.cardBody}>
        <p className={page.connHint}>
          Connect an AWS account once and every Amazon Bedrock asset in your organisation can use it. RegAnchor gets a
          role that can only call Anthropic models, and only with an ID unique to this connection. Usage stays billed
          to your AWS account.
        </p>

        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden>1</span>
            <div className={styles.stepBody}>
              <div className={styles.stepTitle}>Choose the home region</div>
              <p className={styles.stepHint}>
                Where RegAnchor checks the account. Each asset can still choose its own region later.
              </p>
              <SelectMenu
                className={styles.region}
                value={region}
                options={REGION_OPTIONS}
                onChange={(v) => {
                  setRegion(v)
                  setStepError(null)
                }}
                aria-label="AWS region"
              />
              {nameField}
            </div>
          </li>

          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden>2</span>
            <div className={styles.stepBody}>
              <div className={styles.stepTitle}>Create the role in AWS</div>
              <p className={styles.stepHint}>
                Opens CloudFormation with everything filled in. Tick the acknowledgement at the bottom and choose
                Create stack. It takes about a minute and needs an AWS user who can create IAM roles.
              </p>
              <div className={page.actions}>
                <Button size="sm" onClick={() => void launch()} pending={busy === 'launch'}>
                  <BrandIcon slug="aws" size={16} />
                  Launch in AWS
                  <ExternalLink size={13} aria-hidden />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void copySetupLink()} pending={busy === 'link'}>
                  {copied === 'link' ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                  Copy setup link
                </Button>
              </div>
              {errorFor('launch')}
              {setup ? (
                <details className={styles.details}>
                  <summary>Details for your AWS team</summary>
                  <dl className={styles.detailList}>
                    <dt>Stack</dt>
                    <dd className={styles.mono}>{setup.stack_name}</dd>
                    <dt>Role</dt>
                    <dd className={styles.mono}>{setup.role_name}</dd>
                    <dt>External ID</dt>
                    <dd className={styles.copyRow}>
                      <span className={styles.mono}>{setup.external_id}</span>
                      <button
                        type="button"
                        className={styles.copyBtn}
                        onClick={() => void copy(setup.external_id, 'external')}
                        aria-label="Copy external ID"
                      >
                        {copied === 'external' ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    </dd>
                    <dt>Trusted account</dt>
                    <dd className={styles.copyRow}>
                      <span className={page.kvNum}>{fmtAccountId(setup.reganchor_account_id)}</span>
                      <span className={styles.quiet}>RegAnchor</span>
                    </dd>
                    <dt>Template</dt>
                    <dd>
                      <a className={page.cardLink} href={setup.template_url} target="_blank" rel="noreferrer">
                        View template
                      </a>
                    </dd>
                  </dl>
                  <div className={styles.permTitle}>The role can</div>
                  <ul className={styles.perms}>
                    <li>Call Anthropic Claude models, including streamed responses</li>
                    <li>List the models and inference profiles available to the account</li>
                  </ul>
                  <p className={styles.stepHint}>
                    Nothing else: no access to your data, logs, other AWS services or billing.
                  </p>
                </details>
              ) : null}
            </div>
          </li>

          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden>3</span>
            <div className={styles.stepBody}>
              <div className={styles.stepTitle}>Paste the role ARN</div>
              <p className={styles.stepHint}>
                When the stack shows CREATE_COMPLETE, open its Outputs tab and copy the RoleArn value, not the stack ID.
              </p>
              <input
                className={page.input}
                type="text"
                autoComplete="off"
                spellCheck={false}
                aria-label="Role ARN"
                placeholder="arn:aws:iam::123456789012:role/RegAnchorBedrock-…"
                value={roleArn}
                onChange={(e) => {
                  setRoleArn(e.target.value)
                  if (stepError?.at === 'verify') setStepError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && parsedArn && !arnMismatch) void verifyRole()
                }}
              />
              {roleArn.trim() ? (
                <div className={styles.arnState} aria-live="polite">
                  {!parsedArn ? (
                    <span className={styles.quiet}>{roleArnHint(roleArn)}</span>
                  ) : arnMismatch ? (
                    <StatusLabel tone="warn">
                      {`This role is from another RegAnchor setup. Use the ${setup?.stack_name || `RegAnchor-Bedrock-${expectedRef}`} stack.`}
                    </StatusLabel>
                  ) : (
                    <span className={styles.arnOk}>
                      <Check size={13} aria-hidden className={styles.okIcon} />
                      AWS account <span className={page.kvNum}>{fmtAccountId(parsedArn.accountId)}</span>
                    </span>
                  )}
                </div>
              ) : null}
              {errorFor('verify')}
              <div className={page.actions}>
                <Button
                  size="sm"
                  onClick={() => void verifyRole()}
                  pending={busy === 'verify'}
                  disabled={!parsedArn || arnMismatch}
                >
                  Verify and connect
                </Button>
              </div>
            </div>
          </li>
        </ol>
      </div>
      <footer className={clsx(page.cardFoot, styles.foot)}>
        <button type="button" className={styles.linkBtn} onClick={() => { setMode('key'); setStepError(null) }}>
          Use a Bedrock API key instead
        </button>
        {cancel || <span>A supplier's account? Send them the setup link.</span>}
      </footer>
    </>
  )
}
