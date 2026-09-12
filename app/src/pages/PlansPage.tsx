import { useState } from 'react'
import { Button, EmptyState, Notice, PageFrame, PageHeader, Section } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { invokeEdge } from '../lib/edge'
import { stripePriceId, type StripePlan, type StripePeriod } from '../lib/stripe'
import { sb } from '../lib/supabase'
import styles from './PlansPage.module.css'

const ESSENTIALS_FEATS = [
  'Governance Certificate',
  'Public verification page',
  'Assessment reports',
  'Full governance framework',
  'Email support',
]

const PROFESSIONAL_FEATS = [
  'Unlimited AI systems',
  'Multi-user access (5 seats)',
  'Organisation-wide certification',
  'Compliance automation',
  'Priority support',
]

const ENTERPRISE_FEATS = [
  'Everything in Professional',
  'Unlimited users',
  'Dedicated advisory lead',
  'On-site sessions & benchmarking',
  'Custom SLA',
]

export function PlansPage() {
  const { org, user, profile, session } = useAuth()
  const [annual, setAnnual] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showCompare, setShowCompare] = useState(false)
  const [showEnterprise, setShowEnterprise] = useState(false)
  const [entName, setEntName] = useState(profile?.full_name || '')
  const [entRole, setEntRole] = useState('')
  const [entSystems, setEntSystems] = useState('')
  const [entMessage, setEntMessage] = useState('')
  const [entBusy, setEntBusy] = useState(false)
  const [entDone, setEntDone] = useState(false)
  const [entError, setEntError] = useState('')

  usePageChrome({ title: 'Plans', breadcrumbs: [{ label: 'Plans' }] })

  const plan = org?.plan || 'free'
  const isActive = org?.subscription_status === 'active'
  const period: StripePeriod = annual ? 'annual' : 'monthly'
  const ePrice = annual ? '1,290' : '129'
  const pPrice = annual ? '2,490' : '249'
  const per = annual ? '/year' : '/month'
  const essCurrent = plan === 'essentials' && isActive
  const proCurrent = plan === 'professional' && isActive

  async function subscribe(planKey: StripePlan) {
    setError('')
    const priceId = stripePriceId(planKey, period)
    if (!priceId) {
      setError('Stripe price is not configured.')
      return
    }
    if (!org?.id || !session?.access_token) {
      setError('Could not set up your organisation. Please refresh and try again.')
      return
    }
    setCheckoutBusy(planKey)
    try {
      // Hosted Checkout redirect (portal startSubscription). Embedded Stripe.js deferred.
      const data = await invokeEdge<{
        url?: string
        error?: string
        existing?: boolean
      }>('create-subscription-session', { price_id: priceId, org_id: org.id }, session.access_token)
      if (data.existing) {
        setError('Your organisation already has an active subscription.')
        return
      }
      if (data.error) {
        setError(data.error)
        return
      }
      if (data.url) {
        window.location.href = data.url
        return
      }
      setError('Could not start checkout.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load checkout. Please try again.')
    } finally {
      setCheckoutBusy(null)
    }
  }

  function openEnterprise() {
    setEntName(profile?.full_name || '')
    setEntRole('')
    setEntSystems('')
    setEntMessage('')
    setEntError('')
    setEntDone(false)
    setShowEnterprise(true)
  }

  async function submitEnterprise() {
    const name = entName.trim()
    if (!name) {
      setEntError('Please enter your name.')
      return
    }
    setEntError('')
    setEntBusy(true)
    try {
      const email = user?.email || ''
      const orgName = org?.name || ''
      const { error: insertErr } = await sb.from('enterprise_inquiries').insert({
        org_id: org?.id || null,
        user_id: user?.id || null,
        full_name: name,
        email,
        organisation: orgName,
        role_title: entRole.trim() || null,
        system_count: entSystems || null,
        message: entMessage.trim() || null,
      })
      if (insertErr) throw insertErr
      if (org?.id && user?.id) {
        await sb.from('registry_audit_log').insert({
          org_id: org.id,
          user_id: user.id,
          action: 'enterprise_inquiry',
          entity_type: 'organisation',
          entity_id: org.id,
          changes: { _actor_name: profile?.full_name || email },
        })
      }
      setEntDone(true)
    } catch (e) {
      setEntError(e instanceof Error ? e.message : 'Could not submit inquiry.')
    } finally {
      setEntBusy(false)
    }
  }

  return (
    <PageFrame
      railItems={[
        { id: 'pricing', label: 'Pricing' },
        { id: 'compare', label: 'Compare' },
        ...(showEnterprise ? [{ id: 'enterprise', label: 'Enterprise inquiry' }] : []),
      ]}
    >
      <PageHeader
        title="Subscription plans"
        description="Choose the governance tier that matches your organisation."
        actions={
          <div className={styles.period}>
            <button
              type="button"
              className={!annual ? styles.periodActive : styles.periodBtn}
              onClick={() => setAnnual(false)}
            >
              Monthly
            </button>
            <button
              type="button"
              className={annual ? styles.periodActive : styles.periodBtn}
              onClick={() => setAnnual(true)}
            >
              Annual
            </button>
          </div>
        }
      />

      {error ? <Notice tone="risk">{error}</Notice> : null}

      <Section id="pricing" title="Plans">
        <div className={styles.grid}>
          <article className={essCurrent ? `${styles.card} ${styles.cardCurrent}` : styles.card}>
            {!essCurrent ? <div className={styles.flag}>Recommended</div> : null}
            <div className={styles.tier}>Essentials</div>
            <div className={styles.name}>Governance</div>
            <p className={styles.desc}>
              Certified governance maturity with a publicly verifiable certificate.
            </p>
            <div className={styles.price}>
              <span className={styles.currency}>Â£</span>
              <span className={styles.num}>{ePrice}</span>
              <span className={styles.per}>{per}</span>
            </div>
            {annual ? <div className={styles.save}>Save Â£258/yr</div> : null}
            <div className={styles.feats}>
              {ESSENTIALS_FEATS.map((f) => (
                <div key={f} className={styles.feat}>
                  <span className={styles.mark}>âœ“</span>
                  {f}
                </div>
              ))}
            </div>
            {essCurrent ? (
              <div className={styles.current}>Current plan</div>
            ) : (
              <Button pending={checkoutBusy === 'essentials'} onClick={() => void subscribe('essentials')}>
                Get started
              </Button>
            )}
          </article>

          <article className={proCurrent ? `${styles.card} ${styles.cardCurrent}` : styles.card}>
            <div className={styles.tier}>Professional</div>
            <div className={styles.name}>Compliance</div>
            <p className={styles.desc}>
              Operational governance across every system. Audit-ready at scale.
            </p>
            <div className={styles.price}>
              <span className={styles.currency}>Â£</span>
              <span className={styles.num}>{pPrice}</span>
              <span className={styles.per}>{per}</span>
            </div>
            {annual ? <div className={styles.save}>Save Â£498/yr</div> : null}
            <div className={styles.feats}>
              {PROFESSIONAL_FEATS.map((f) => (
                <div key={f} className={styles.feat}>
                  <span className={styles.mark}>âœ“</span>
                  {f}
                </div>
              ))}
            </div>
            {proCurrent ? (
              <div className={styles.current}>Current plan</div>
            ) : (
              <Button
                pending={checkoutBusy === 'professional'}
                onClick={() => void subscribe('professional')}
              >
                Upgrade to Professional
              </Button>
            )}
          </article>

          <article className={styles.card}>
            <div className={styles.tier}>Enterprise</div>
            <div className={styles.name}>Governance OS</div>
            <p className={styles.desc}>
              Bespoke governance infrastructure for multi-jurisdiction obligations.
            </p>
            <div className={styles.price}>
              <span className={styles.numWide}>Bespoke</span>
            </div>
            <div className={styles.save}>Tailored to your organisation</div>
            <div className={styles.feats}>
              {ENTERPRISE_FEATS.map((f) => (
                <div key={f} className={styles.feat}>
                  <span className={styles.mark}>âœ“</span>
                  {f}
                </div>
              ))}
            </div>
            <Button variant="ghost" onClick={openEnterprise}>
              Talk to advisory
            </Button>
          </article>
        </div>
      </Section>

      <Section id="compare" title="Feature comparison">
        <Button variant="ghost" onClick={() => setShowCompare((v) => !v)}>
          {showCompare ? 'Hide comparison' : 'Compare all features'}
        </Button>
        {showCompare ? (
          <div className={styles.compareWrap}>
            <table className={styles.compare}>
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Free</th>
                  <th>Essentials</th>
                  <th>Professional</th>
                  <th>Enterprise</th>
                </tr>
              </thead>
              <tbody>
                <tr className={styles.sectionRow}>
                  <td colSpan={5}>Diagnostics & assessment</td>
                </tr>
                <tr>
                  <td>Assessment reports</td>
                  <td>â€”</td>
                  <td>âœ“</td>
                  <td>âœ“</td>
                  <td>âœ“</td>
                </tr>
                <tr>
                  <td>AI systems in registry</td>
                  <td>1</td>
                  <td>1</td>
                  <td>Unlimited</td>
                  <td>Unlimited</td>
                </tr>
                <tr>
                  <td>Users</td>
                  <td>1</td>
                  <td>1</td>
                  <td>Up to 5</td>
                  <td>Unlimited</td>
                </tr>
                <tr>
                  <td>Governance certificate</td>
                  <td>â€”</td>
                  <td>âœ“</td>
                  <td>âœ“</td>
                  <td>âœ“</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      {showEnterprise ? (
        <Section id="enterprise" title="Enterprise inquiry">
          {entDone ? (
            <EmptyState
              title="Inquiry received"
              body={`Thank you, ${entName.split(' ')[0] || 'there'}. A RegAnchor governance specialist will be in touch within 24 hours.`}
              action={
                <Button variant="ghost" onClick={() => setShowEnterprise(false)}>
                  Close
                </Button>
              }
            />
          ) : (
            <div className={styles.entForm}>
              <label className={styles.field}>
                Full name
                <input className={styles.input} value={entName} onChange={(e) => setEntName(e.target.value)} />
              </label>
              <label className={styles.field}>
                Role title
                <input
                  className={styles.input}
                  value={entRole}
                  onChange={(e) => setEntRole(e.target.value)}
                  placeholder="e.g. Head of AI Governance"
                />
              </label>
              <label className={styles.field}>
                Approximate AI systems
                <input
                  className={styles.input}
                  value={entSystems}
                  onChange={(e) => setEntSystems(e.target.value)}
                  placeholder="e.g. 10â€“50"
                />
              </label>
              <label className={styles.field}>
                Message
                <textarea
                  className={styles.textarea}
                  rows={4}
                  value={entMessage}
                  onChange={(e) => setEntMessage(e.target.value)}
                />
              </label>
              {entError ? <Notice tone="risk">{entError}</Notice> : null}
              <div className={styles.entActions}>
                <Button pending={entBusy} onClick={() => void submitEnterprise()}>
                  Submit inquiry
                </Button>
                <Button variant="ghost" onClick={() => setShowEnterprise(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Section>
      ) : null}
    </PageFrame>
  )
}
