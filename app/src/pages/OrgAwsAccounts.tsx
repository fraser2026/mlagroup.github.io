import { useCallback, useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { CircleCheck } from 'lucide-react'
import { Button, EmptyState, Notice, StatusLabel } from '../ui'
import { BrandIcon } from '../icons/BrandIcon'
import { invokeEdge } from '../lib/edge'
import {
  accessStep,
  accountAccess,
  accountTitle,
  fmtAccountId,
  isUsableAccount,
  loadAwsAccounts,
  loadAwsAccountUsage,
  regionName,
  type AwsAccount,
} from '../lib/aws'
import { AwsAccessNotice } from './AwsAccessNotice'
import { AwsAccountSetup } from './AwsAccountSetup'
import page from './RegistryDetailPage.module.css'
import styles from './OrgAwsAccounts.module.css'

type Props = {
  orgId: string
  userId?: string
  canManage: boolean
  accessToken?: string
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/** Regions where the last test call found a step to take in AWS. */
function blockedRegions(a: AwsAccount) {
  return Object.entries(a.models || {}).filter(([region, entry]) => accessStep(entry.access, region))
}

/** Organisation page: AWS accounts connected once and shared by Amazon Bedrock assets. */
export function OrgAwsAccounts({ orgId, userId, canManage, accessToken }: Props) {
  const [accounts, setAccounts] = useState<AwsAccount[] | null>(null)
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [connecting, setConnecting] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [confirming, setConfirming] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<{ id: string; text: string } | null>(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const [list, counts] = await Promise.all([loadAwsAccounts(orgId), loadAwsAccountUsage(orgId)])
    setAccounts(list)
    setUsage(counts)
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const usable = useMemo(() => (accounts || []).filter(isUsableAccount), [accounts])
  const pending = useMemo(
    () => [...(accounts || [])].reverse().find((a) => a.status === 'pending' && a.created_by === userId) || null,
    [accounts, userId],
  )

  async function call<T>(body: Record<string, unknown>): Promise<T> {
    if (!accessToken) throw new Error('Sign in again to continue.')
    return invokeEdge<T>('aws-connect', { org_id: orgId, ...body }, accessToken)
  }

  async function run(key: string, id: string, task: () => Promise<string>) {
    setError(null)
    setNotice('')
    setBusy(key)
    try {
      setNotice(await task())
    } catch (e) {
      setError({ id, text: e instanceof Error ? e.message : 'Something went wrong. Try again.' })
    } finally {
      setBusy('')
      await load()
    }
  }

  const check = (a: AwsAccount) =>
    run(`check:${a.id}`, a.id, async () => {
      const res = await call<{ account: AwsAccount }>({ action: 'check', account: a.id })
      return blockedRegions(res.account).length
        ? `${accountTitle(a)} checked. RegAnchor can reach Amazon Bedrock, but Claude needs one more step in AWS.`
        : `${accountTitle(a)} checked. RegAnchor can reach Amazon Bedrock and call Claude with it.`
    })

  const saveName = (a: AwsAccount) =>
    run(`rename:${a.id}`, a.id, async () => {
      await call({ action: 'rename', account: a.id, label: renaming?.value || '' })
      setRenaming(null)
      return 'Name saved.'
    })

  const disconnect = (a: AwsAccount) =>
    run(`disconnect:${a.id}`, a.id, async () => {
      const res = await call<{ assets: number; stack_name: string | null }>({ action: 'disconnect', account: a.id })
      setConfirming('')
      const assets = res.assets ? ` ${plural(res.assets, 'asset no longer uses', 'assets no longer use')} it.` : ''
      const stack = res.stack_name ? ` To remove the role from AWS, delete the ${res.stack_name} stack in CloudFormation.` : ''
      return `${accountTitle(a)} disconnected.${assets}${stack}`
    })

  async function connected(a: AwsAccount) {
    setConnecting(false)
    await load()
    setNotice(`${accountTitle(a)} connected. Bedrock assets can now choose it on their Connection tab.`)
  }

  if (accounts === null) return <p className={styles.quiet}>Loading AWS accounts…</p>

  return (
    <div className={styles.wrap}>
      {usable.length ? (
        <ul className={styles.list}>
          {usable.map((a) => {
            const n = usage[a.id] || 0
            const isRenaming = renaming?.id === a.id
            const blocked = blockedRegions(a)
            return (
              <li key={a.id} className={styles.item}>
                <div className={styles.row}>
                  <BrandIcon slug="aws" size={20} />
                  <div className={styles.main}>
                    {isRenaming ? (
                      <div className={styles.rename}>
                        <input
                          className={clsx(page.input, styles.renameInput)}
                          value={renaming.value}
                          maxLength={60}
                          autoFocus
                          aria-label="Account name"
                          placeholder="For example Production"
                          onChange={(e) => setRenaming({ id: a.id, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveName(a)
                            if (e.key === 'Escape') setRenaming(null)
                          }}
                        />
                        <Button size="sm" onClick={() => void saveName(a)} pending={busy === `rename:${a.id}`}>
                          Save
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className={styles.title}>{accountTitle(a)}</div>
                    )}
                    <div className={styles.sub}>
                      {[
                        a.label && a.aws_account_id ? fmtAccountId(a.aws_account_id) : null,
                        regionName(a.home_region),
                        accountAccess(a),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <span className={styles.usage}>{n ? plural(n, 'asset', 'assets') : 'Not used yet'}</span>
                  <StatusLabel tone={a.status === 'error' ? 'risk' : blocked.length ? 'warn' : 'ok'}>
                    {a.status === 'error' ? 'Needs attention' : blocked.length ? 'Action needed in AWS' : 'Connected'}
                  </StatusLabel>
                  {canManage && !isRenaming ? (
                    <div className={styles.actions}>
                      <Button variant="ghost" size="sm" onClick={() => void check(a)} pending={busy === `check:${a.id}`}>
                        Check
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRenaming({ id: a.id, value: a.label || '' })}>
                        Rename
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirming(a.id)}>
                        Disconnect
                      </Button>
                    </div>
                  ) : null}
                </div>

                {a.last_error ? <Notice tone="risk">{a.last_error}</Notice> : null}
                {a.status !== 'error'
                  ? blocked.map(([region, entry]) => <AwsAccessNotice key={region} access={entry.access} region={region} />)
                  : null}
                {error?.id === a.id ? <Notice tone="risk">{error.text}</Notice> : null}

                {confirming === a.id ? (
                  <div className={styles.confirm}>
                    <div className={styles.confirmTitle}>Disconnect {accountTitle(a)}?</div>
                    <p className={styles.confirmBody}>
                      {n
                        ? `${plural(n, 'asset stops', 'assets stop')} using it straight away. `
                        : 'No assets use it. '}
                      {a.method === 'role'
                        ? `To remove the role from AWS too, delete the RegAnchor-Bedrock-${a.connection_ref} stack in CloudFormation afterwards.`
                        : 'You can also delete the API key in the Amazon Bedrock console.'}
                    </p>
                    <div className={styles.confirmActions}>
                      <Button size="sm" onClick={() => void disconnect(a)} pending={busy === `disconnect:${a.id}`}>
                        Disconnect
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirming('')}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : !connecting ? (
        <EmptyState
          title="No AWS accounts connected"
          body="Connect the AWS accounts where your teams or suppliers run Claude on Amazon Bedrock. Each one is set up once and shared by your Bedrock assets."
          action={
            canManage ? (
              <Button size="sm" onClick={() => setConnecting(true)}>
                <BrandIcon slug="aws" size={16} />
                Connect AWS account
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {notice ? <Notice icon={CircleCheck}>{notice}</Notice> : null}

      {connecting ? (
        <section className={clsx(page.connCard, styles.setup)}>
          <header className={page.cardHead}>
            <div className={page.cardHeadMain}>
              <BrandIcon slug="aws" size={16} />
              <span className={page.cardTitle}>Connect an AWS account</span>
            </div>
          </header>
          <AwsAccountSetup
            orgId={orgId}
            pending={pending}
            accessToken={accessToken}
            onConnected={connected}
            onCancel={() => setConnecting(false)}
            onToast={setNotice}
          />
        </section>
      ) : usable.length && canManage ? (
        <div className={styles.footerActions}>
          <Button variant="ghost" size="sm" onClick={() => { setNotice(''); setConnecting(true) }}>
            Connect another AWS account
          </Button>
        </div>
      ) : null}

      {!canManage && !usable.length ? (
        <p className={styles.quiet}>An organisation owner or admin connects AWS accounts.</p>
      ) : null}
    </div>
  )
}
