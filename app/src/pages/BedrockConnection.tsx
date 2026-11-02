import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { Button, Notice, SelectMenu, StatusLabel } from '../ui'
import { BrandIcon } from '../icons/BrandIcon'
import { useAuth } from '../auth/AuthProvider'
import { invokeEdge } from '../lib/edge'
import { connectionLabel, labelProvider } from '../lib/registry'
import {
  accountAccess,
  accountTitle,
  fmtAccountId,
  isUsableAccount,
  loadAwsAccounts,
  loadAwsAccountUsage,
  modelRoutes,
  REGION_OPTIONS,
  regionModels,
  regionName,
  type AwsAccount,
} from '../lib/aws'
import { AwsAccountSetup } from './AwsAccountSetup'
import page from './RegistryDetailPage.module.css'
import styles from './BedrockConnection.module.css'

type ConnRow = {
  id: string
  status?: string | null
  last_verified_at?: string | null
  last_error?: string | null
  org_aws_account_id?: string | null
  metadata?: unknown
} | null

type Props = {
  assetId: string
  /** Bedrock model ID on the asset, e.g. anthropic.claude-sonnet-5 or meta.llama-4-70b. */
  assetModel?: string | null
  assetModelLabel?: string
  conn: ConnRow
  canManage: boolean
  onChanged: () => Promise<void> | void
  onToast: (text: string) => void
  /** Gateway card shown beside the connection once an account is linked. */
  gateway?: ReactNode
  /** Gateway activity shown below the cards once an account is linked. */
  activity?: ReactNode
}

type View = 'linked' | 'choose' | 'setup'

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

export function BedrockConnection({
  assetId,
  assetModel,
  assetModelLabel,
  conn,
  canManage,
  onChanged,
  onToast,
  gateway,
  activity,
}: Props) {
  const { org, session } = useAuth()
  const orgId = org?.id || ''
  const accessToken = session?.access_token
  const nonClaudeModel = !!assetModel && !/(^|\.)anthropic\./.test(assetModel)

  const [accounts, setAccounts] = useState<AwsAccount[] | null>(null)
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [view, setView] = useState<View | null>(null)
  const [choice, setChoice] = useState('')
  const [choiceRegion, setChoiceRegion] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const loadAccounts = useCallback(async () => {
    if (!orgId) return
    const [list, counts] = await Promise.all([loadAwsAccounts(orgId), loadAwsAccountUsage(orgId)])
    setAccounts(list)
    setUsage(counts)
  }, [orgId])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  const usable = useMemo(() => (accounts || []).filter(isUsableAccount), [accounts])
  const pending = useMemo(
    () => [...(accounts || [])].reverse().find((a) => a.status === 'pending' && a.created_by === session?.user?.id) || null,
    [accounts, session?.user?.id],
  )
  const linkedRegion = ((conn?.metadata as { aws?: { region?: string } } | null)?.aws?.region) || null
  const linked =
    conn && conn.org_aws_account_id && (conn.status === 'connected' || conn.status === 'error')
      ? usable.find((a) => a.id === conn.org_aws_account_id) || null
      : null

  const current: View = view || (linked ? 'linked' : usable.length ? 'choose' : 'setup')
  const chosen = usable.find((a) => a.id === choice) || usable[0] || null
  const region = current === 'linked' ? linkedRegion : choiceRegion || chosen?.home_region || null
  const shownAccount = current === 'linked' ? linked : current === 'choose' ? chosen : null
  const models = regionModels(shownAccount, region)
  const others = linked ? Math.max((usage[linked.id] || 0) - 1, 0) : 0

  function openChoose() {
    const start = linked || usable[0] || null
    setChoice(start?.id || '')
    setChoiceRegion(linked ? linkedRegion || '' : start?.home_region || '')
    setError('')
    setConfirmRemove(false)
    setView('choose')
  }

  async function call<T>(body: Record<string, unknown>): Promise<T> {
    if (!accessToken) throw new Error('Sign in again to continue.')
    return invokeEdge<T>('aws-connect', { asset_id: assetId, ...body }, accessToken)
  }

  async function run(name: string, task: () => Promise<void>) {
    setError('')
    setBusy(name)
    try {
      await task()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.')
      await Promise.all([loadAccounts(), onChanged()])
    } finally {
      setBusy('')
    }
  }

  const linkChosen = () =>
    run('link', async () => {
      if (!chosen) return
      const target = choiceRegion || chosen.home_region
      await call({ action: 'link', account: chosen.id, region: target })
      await Promise.all([loadAccounts(), onChanged()])
      setView(null)
      onToast(`${accountTitle(chosen)} linked in ${regionName(target)}.`)
    })

  const check = () =>
    run('check', async () => {
      if (!linked) return
      const res = await call<{ account: AwsAccount }>({ action: 'check', account: linked.id, region: linkedRegion })
      await Promise.all([loadAccounts(), onChanged()])
      const n = regionModels(res.account, linkedRegion)?.models.length || 0
      onToast(`Connection checked. ${plural(n, 'Claude model', 'Claude models')} available.`)
    })

  const remove = () =>
    run('unlink', async () => {
      await call({ action: 'unlink' })
      setConfirmRemove(false)
      await Promise.all([loadAccounts(), onChanged()])
      setView(null)
      onToast('AWS account removed from this asset.')
    })

  async function connected(account: AwsAccount) {
    await Promise.all([loadAccounts(), onChanged()])
    setView(null)
    const n = regionModels(account, account.home_region)?.models.length || 0
    onToast(`${accountTitle(account)} connected. ${plural(n, 'Claude model', 'Claude models')} available.`)
  }

  const statusTone = linked ? (conn?.status === 'error' || linked.status === 'error' ? 'risk' : 'ok') : 'warn'
  const statusText = linked ? connectionLabel(linked.status === 'error' ? 'error' : conn?.status) : 'Not connected'

  return (
    <div className={clsx(page.connWrap, styles.wrap)}>
      {nonClaudeModel ? (
        <Notice tone="quiet">
          The AWS connection covers Anthropic Claude models on Amazon Bedrock. This asset is set to{' '}
          {assetModelLabel || assetModel}, which RegAnchor does not govern through AWS yet.
        </Notice>
      ) : null}
      <div className={clsx(page.connGrid, styles.grid)}>
        <section className={clsx(page.connCard, styles.main)} id="connection">
          <header className={page.cardHead}>
            <div className={page.cardHeadMain}>
              <BrandIcon slug="bedrock" size={16} title={labelProvider('bedrock')} />
              <span className={page.cardTitle}>{labelProvider('bedrock')}</span>
            </div>
            <StatusLabel badge tone={statusTone}>
              {statusText}
            </StatusLabel>
          </header>

          {accounts === null ? (
            <div className={page.cardBody}>
              <p className={page.connHint}>Loading AWS accounts…</p>
            </div>
          ) : current === 'linked' && linked ? (
            <>
              <div className={page.cardBody}>
                <dl className={clsx(page.kv, styles.kv)}>
                  <dt>AWS account</dt>
                  <dd className={styles.account}>
                    <BrandIcon slug="aws" size={16} />
                    {linked.label ? (
                      <span>
                        {linked.label}
                        {linked.aws_account_id ? <span className={styles.code}>{fmtAccountId(linked.aws_account_id)}</span> : null}
                      </span>
                    ) : (
                      <span className={page.kvNum}>{accountTitle(linked)}</span>
                    )}
                  </dd>
                  <dt>Region</dt>
                  <dd>
                    {regionName(linkedRegion)} <span className={styles.code}>{linkedRegion}</span>
                  </dd>
                  <dt>Access</dt>
                  <dd>
                    {linked.method === 'role' ? (
                      <>
                        IAM role <span className={styles.code}>{linked.role_arn?.split('/').pop()}</span>
                      </>
                    ) : (
                      'Bedrock API key, stored in Vault'
                    )}
                  </dd>
                  <dt>Checked</dt>
                  <dd className={page.kvNum}>
                    {models?.checked_at || linked.last_verified_at
                      ? fmtDateTime(models?.checked_at || linked.last_verified_at || '')
                      : 'Not yet'}
                  </dd>
                </dl>

                {linked.last_error ? <Notice tone="risk">{linked.last_error}</Notice> : null}
                {error ? <Notice tone="risk">{error}</Notice> : null}

                {canManage ? (
                  confirmRemove ? (
                    <div className={page.cardSection}>
                      <div className={page.sectionLabel}>Remove this AWS account from the asset?</div>
                      <p className={page.connHint}>
                        RegAnchor stops using it for this asset straight away. The account stays connected for the
                        rest of your organisation. To disconnect it everywhere, use the Organisation page.
                      </p>
                      <div className={page.actions}>
                        <Button size="sm" onClick={() => void remove()} pending={busy === 'unlink'}>
                          Remove
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className={page.actions}>
                      <Button variant="ghost" size="sm" onClick={() => void check()} pending={busy === 'check'}>
                        Check connection
                      </Button>
                      <Button variant="ghost" size="sm" onClick={openChoose}>
                        Change
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { setError(''); setConfirmRemove(true) }}>
                        Remove from asset
                      </Button>
                    </div>
                  )
                ) : null}
              </div>
              <footer className={page.cardFoot}>
                <span>
                  {others
                    ? `Shared with ${plural(others, 'other asset', 'other assets')}`
                    : 'Connected once for your organisation'}
                </span>
                <Link className={page.cardLink} to="/organisation#aws">
                  AWS accounts
                </Link>
              </footer>
            </>
          ) : !canManage ? (
            <div className={page.cardBody}>
              <p className={page.connHint}>
                An organisation owner or admin chooses the AWS account this asset runs in.
              </p>
            </div>
          ) : current === 'choose' && chosen ? (
            <>
              <div className={page.cardBody}>
                <p className={page.connHint}>
                  Choose the AWS account this asset runs in, from the accounts your organisation has connected.
                </p>
                <label className={page.fieldBlock}>
                  <span className={styles.label}>AWS account</span>
                  <SelectMenu
                    className={styles.region}
                    value={chosen.id}
                    options={usable.map((a) => ({
                      value: a.id,
                      label: accountTitle(a),
                      description: [
                        a.label && a.aws_account_id ? fmtAccountId(a.aws_account_id) : accountAccess(a),
                        regionName(a.home_region),
                      ].join(' · '),
                      icon: <BrandIcon slug="aws" size={16} />,
                    }))}
                    onChange={(v) => {
                      setChoice(v)
                      setChoiceRegion(usable.find((a) => a.id === v)?.home_region || '')
                      setError('')
                    }}
                    aria-label="AWS account"
                  />
                </label>
                <label className={page.fieldBlock}>
                  <span className={styles.label}>Region</span>
                  <SelectMenu
                    className={styles.region}
                    value={region || chosen.home_region}
                    options={REGION_OPTIONS}
                    onChange={(v) => {
                      setChoiceRegion(v)
                      setError('')
                    }}
                    aria-label="AWS region"
                  />
                </label>
                {chosen.status === 'error' ? (
                  <Notice tone="risk">
                    {chosen.last_error || `${accountTitle(chosen)} failed its last check.`} Check it on the Organisation page.
                  </Notice>
                ) : null}
                {error ? <Notice tone="risk">{error}</Notice> : null}
                <div className={page.actions}>
                  <Button
                    size="sm"
                    onClick={() => void linkChosen()}
                    pending={busy === 'link'}
                    disabled={chosen.status !== 'connected'}
                  >
                    {linked ? 'Save' : 'Use this account'}
                  </Button>
                  {linked ? (
                    <Button variant="ghost" size="sm" onClick={() => { setView(null); setError('') }}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
              <footer className={clsx(page.cardFoot, styles.foot)}>
                <button type="button" className={styles.linkBtn} onClick={() => { setError(''); setView('setup') }}>
                  Connect another AWS account
                </button>
                <span>{plural(usable.length, 'account', 'accounts')} connected</span>
              </footer>
            </>
          ) : (
            <AwsAccountSetup
              orgId={orgId}
              assetId={assetId}
              pending={pending}
              accessToken={accessToken}
              onConnected={connected}
              onCancel={usable.length ? () => setView(null) : undefined}
              onToast={onToast}
            />
          )}
        </section>

        <section className={clsx(page.connCard, styles.modelsCard)} id="models">
          <header className={page.cardHead}>
            <span className={page.cardTitle}>Claude models</span>
            {models?.models.length ? <span className={clsx(styles.count, page.kvNum)}>{models.models.length}</span> : null}
          </header>
          <div className={page.cardBody}>
            {models?.models.length ? (
              <ul className={styles.models}>
                {models.models.map((m) => (
                  <li key={m.id} className={styles.model}>
                    <span className={styles.modelName}>{m.name}</span>
                    <span className={styles.routes}>
                      {modelRoutes(m).map((r) => (
                        <span key={r} className={styles.route}>{r}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={page.connHint}>
                {current === 'choose' && chosen
                  ? `Models for ${regionName(region)} appear once this account is used there.`
                  : 'Once connected, the Claude models this AWS account can use in the chosen region appear here.'}
              </p>
            )}
          </div>
          {models?.models.length ? (
            <footer className={page.cardFoot}>
              <span>From Amazon Bedrock, {regionName(region)}</span>
              <span className={page.kvNum}>{fmtDateTime(models.checked_at)}</span>
            </footer>
          ) : null}
        </section>

        {linked && current === 'linked' && gateway ? <div className={styles.gatewaySlot}>{gateway}</div> : null}
      </div>
      {linked && current === 'linked' ? activity : null}
    </div>
  )
}
