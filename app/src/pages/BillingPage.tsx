import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  DataTable,
  EmptyState,
  Notice,
  PageFrame,
  PageHeader,
  Section,
  StatusLabel,
  type StatusTone,
} from '../ui'
import type { ColumnDef } from '@tanstack/react-table'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { EdgeError, invokeEdge } from '../lib/edge'
import { fmtDate } from '../lib/rpc'
import { PLAN_LABELS } from '../lib/stripe'
import { sb } from '../lib/supabase'
import styles from './BillingPage.module.css'

type BillingOverview = {
  plan?: string | null
  status?: string | null
  periodEnd?: string | null
  hasCustomer?: boolean
  hasSubscription?: boolean
  amount?: string | null
  interval?: string | null
  paymentMethod?: {
    brand?: string | null
    last4?: string | null
    expMonth?: number | null
    expYear?: number | null
  } | null
  invoices?: Array<{
    id?: string
    date?: string | null
    description?: string | null
    amount?: string | null
    url?: string | null
  }>
}

type Invoice = NonNullable<BillingOverview['invoices']>[number]

function billingStatusMeta(status?: string | null): { label: string; tone: StatusTone } {
  const s = String(status || '').toLowerCase()
  if (s === 'active') return { label: 'Active', tone: 'ok' }
  if (s === 'trialing') return { label: 'Trial', tone: 'ok' }
  if (s === 'past_due' || s === 'unpaid') return { label: 'Past due', tone: 'risk' }
  if (s === 'incomplete' || s === 'incomplete_expired') return { label: 'Incomplete', tone: 'warn' }
  if (s === 'canceling' || s === 'cancelling') return { label: 'Cancels at period end', tone: 'warn' }
  if (s === 'canceled' || s === 'cancelled') return { label: 'Cancelled', tone: 'neutral' }
  if (s === 'none' || !s) return { label: 'Not subscribed', tone: 'neutral' }
  return { label: s.replace(/_/g, ' '), tone: 'neutral' }
}

function billingIntervalLabel(interval?: string | null) {
  if (interval === 'year' || interval === 'annual') return 'Annual'
  if (interval === 'month' || interval === 'monthly') return 'Monthly'
  return interval || '\u2014'
}

function billingPriceLine(amount?: string | null, interval?: string | null) {
  if (!amount) return '\u2014'
  if (interval === 'year' || interval === 'annual') return `${amount} / year`
  if (interval === 'month' || interval === 'monthly') return `${amount} / month`
  return amount
}

function billingNextPaymentCopy(iso?: string | null, status?: string | null) {
  const st = String(status || '').toLowerCase()
  if (!iso) return ''
  const when = new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  if (st === 'canceled' || st === 'cancelled') return `This subscription ended on ${when}.`
  if (st === 'canceling' || st === 'cancelling')
    return `Access continues until ${when}, when the subscription ends.`
  if (st === 'past_due' || st === 'unpaid')
    return `Payment is overdue. The current period ends on ${when}.`
  return `Your next payment is scheduled for ${when}.`
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n)
}

export function BillingPage() {
  const { org, canManageMembers, session, refreshOrg } = useAuth()
  const [overview, setOverview] = useState<BillingOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [portalBusy, setPortalBusy] = useState(false)
  const [portalError, setPortalError] = useState('')
  const [loadError, setLoadError] = useState('')

  usePageChrome({ title: 'Billing', breadcrumbs: [{ label: 'Billing' }] })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!org?.id || !session?.access_token) {
        setLoading(false)
        return
      }
      setLoading(true)
      setLoadError('')
      try {
        await sb.from('organisations').select('*').eq('id', org.id).maybeSingle()
        await refreshOrg()
        const data = await invokeEdge<BillingOverview>('get-billing-overview', {}, session.access_token)
        if (!cancelled) setOverview(data)
      } catch (e) {
        if (!cancelled) {
          setOverview(null)
          setLoadError(e instanceof Error ? e.message : 'Billing could not be loaded.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [org?.id, session?.access_token])

  async function openBillingPortal() {
    setPortalError('')
    if (!canManageMembers) {
      setPortalError('Only an owner or admin can manage the organisation subscription.')
      return
    }
    if (!session?.access_token) return
    setPortalBusy(true)
    try {
      const data = await invokeEdge<{ url?: string }>(
        'create-billing-portal-session',
        { return_origin: window.location.origin },
        session.access_token,
      )
      if (!data?.url) throw new Error('no-url')
      window.location.href = data.url
    } catch (err) {
      setPortalBusy(false)
      const status = err instanceof EdgeError ? err.status : 0
      if (status === 400) setPortalError('No subscription is linked yet. Choose a plan to get started.')
      else if (status === 403)
        setPortalError('Only an owner or admin can manage the organisation subscription.')
      else
        setPortalError(
          'Billing settings could not be opened. Try again, or contact support if this continues.',
        )
    }
  }

  const planKey = overview?.plan || org?.plan || ''
  const statusKey = overview?.status || org?.subscription_status || ''
  const periodEnd = overview?.periodEnd || org?.subscription_period_end || null
  const hasCustomer = overview ? !!overview.hasCustomer : !!org?.stripe_customer_id
  const hasSub = overview ? !!overview.hasSubscription : !!org?.stripe_subscription_id
  const planLabel =
    PLAN_LABELS[planKey] ||
    (planKey && planKey !== 'free' ? planKey.charAt(0).toUpperCase() + planKey.slice(1) : '')
  const st = billingStatusMeta(statusKey)
  const amountLine = overview ? billingPriceLine(overview.amount, overview.interval) : '\u2014'
  const intervalLabel = overview ? billingIntervalLabel(overview.interval) : '\u2014'
  const nextCopy = billingNextPaymentCopy(periodEnd, statusKey)
  const invoices = overview?.invoices || []
  const pm = overview?.paymentMethod

  const invoiceCols: ColumnDef<Invoice>[] = [
    {
      accessorKey: 'date',
      header: 'Date',
      cell: ({ row }) => fmtDate(row.original.date),
    },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ row }) => row.original.description || 'RegAnchor subscription',
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      cell: ({ row }) => row.original.amount || '\u2014',
    },
    {
      id: 'act',
      header: '',
      cell: ({ row }) =>
        row.original.url ? (
          <a className={styles.invoiceLink} href={row.original.url} target="_blank" rel="noreferrer">
            Invoice
          </a>
        ) : (
          '\u2014'
        ),
    },
  ]

  return (
    <PageFrame
      railItems={[
        { id: 'plan', label: 'Current plan' },
        { id: 'payment', label: 'Payment method' },
        { id: 'history', label: 'Billing history' },
      ]}
    >
      <PageHeader title="Billing" description="Subscription status, payment method, and invoices." />
      {loadError ? <Notice tone="risk">{loadError}</Notice> : null}

      {loading ? (
        <BrandLoader fill label="Loading billing" />
      ) : !org ? (
        <EmptyState title="Organisation not found" body="Refresh the page and try again." />
      ) : !hasCustomer && !hasSub ? (
        <Section id="plan" title="Current plan">
          <EmptyState
            title="No active subscription"
            body="No Stripe customer or subscription is associated with this organisation. Choose a plan to start billing."
            action={
              <Link to="/plans">
                <Button>View plans</Button>
              </Link>
            }
          />
        </Section>
      ) : (
        <>
          <Section id="plan" title="Current plan" description={st.label}>
            <div className={styles.metaGrid}>
              <div className={styles.metaItem}>
                <label>Current plan</label>
                <span>{planLabel || 'Not set'}</span>
              </div>
              <div className={styles.metaItem}>
                <label>Price</label>
                <span>{amountLine}</span>
              </div>
              <div className={styles.metaItem}>
                <label>Subscription status</label>
                <StatusLabel tone={st.tone}>{st.label}</StatusLabel>
              </div>
              <div className={styles.metaItem}>
                <label>Billing interval</label>
                <span>{intervalLabel}</span>
              </div>
              {periodEnd ? (
                <div className={styles.metaItem}>
                  <label>Next payment</label>
                  <span>{fmtDate(periodEnd)}</span>
                </div>
              ) : null}
            </div>
            {nextCopy ? <p className={styles.copy}>{nextCopy}</p> : null}
            <div className={styles.actions}>
              {!canManageMembers ? (
                <Notice>Only an owner or admin can change payment details or the plan.</Notice>
              ) : !hasCustomer ? (
                <Link to="/plans">
                  <Button>View plans</Button>
                </Link>
              ) : (
                <Button pending={portalBusy} onClick={() => void openBillingPortal()}>
                  Manage subscription
                </Button>
              )}
            </div>
            {portalError ? <Notice tone="risk">{portalError}</Notice> : null}
          </Section>

          <Section id="payment" title="Payment method">
            {pm?.last4 ? (
              <>
                <div className={styles.metaGrid}>
                  <div className={styles.metaItem}>
                    <label>Payment method</label>
                    <span>
                      {pm.brand || 'Card'} {'\u2022\u2022\u2022\u2022'} {pm.last4}
                    </span>
                  </div>
                  {pm.expMonth && pm.expYear ? (
                    <div className={styles.metaItem}>
                      <label>Expiry</label>
                      <span>
                        Expires {pad2(pm.expMonth)}/{String(pm.expYear).slice(-2)}
                      </span>
                    </div>
                  ) : null}
                </div>
                <p className={styles.copy}>
                  Card details are stored by Stripe. Update them from billing settings. RegAnchor does
                  not collect or store payment cards.
                </p>
              </>
            ) : (
              <p className={styles.copy}>
                No payment method is on file yet. Add or update one in Stripe billing settings.
              </p>
            )}
            {hasCustomer && canManageMembers ? (
              <div className={styles.actions}>
                <Button variant="ghost" pending={portalBusy} onClick={() => void openBillingPortal()}>
                  Update payment method
                </Button>
              </div>
            ) : null}
          </Section>

          <Section id="history" title="Billing history" description="Recent invoices">
            <DataTable
              data={invoices}
              columns={invoiceCols}
              getRowId={(row) => row.id || row.date || row.description || 'inv'}
              empty={
                <EmptyState
                  title="No invoices yet"
                  body="Full history is available in Stripe billing settings."
                />
              }
            />
            {hasCustomer && canManageMembers ? (
              <div className={styles.actions}>
                <Button variant="ghost" pending={portalBusy} onClick={() => void openBillingPortal()}>
                  View all invoices
                </Button>
              </div>
            ) : null}
          </Section>

          <Section id="change" title="Need to change your plan?">
            <p className={styles.copy}>
              Upgrade, downgrade or cancel your subscription from your billing settings.
            </p>
            <div className={styles.actions}>
              {hasCustomer && canManageMembers ? (
                <Button variant="ghost" pending={portalBusy} onClick={() => void openBillingPortal()}>
                  Manage subscription
                </Button>
              ) : (
                <Link to="/plans">
                  <Button variant="ghost">View plans</Button>
                </Link>
              )}
            </div>
          </Section>
        </>
      )}
    </PageFrame>
  )
}
