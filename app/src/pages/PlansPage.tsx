import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { loadStripe, type StripeEmbeddedCheckout } from '@stripe/stripe-js'
import { Button, Drawer, EmptyState, Icon, Notice, PageFrame, PageHeader, Section, SelectMenu } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { invokeEdge } from '../lib/edge'
import {
  stripePriceId,
  stripePublishableKey,
  type StripePlan,
  type StripePeriod,
} from '../lib/stripe'
import { sb } from '../lib/supabase'
import styles from './PlansPage.module.css'

const ESSENTIALS_FEATS = [
  'AI asset registry',
  'Risk assessment & classification',
  'Policy management',
  'Evidence management',
  'Data backend connections',
]

const PROFESSIONAL_FEATS = [
  'Unlimited AI assets',
  'Multi-user access (15 seats)',
  'Continuous monitoring',
  'Auditor export',
  'API & integrations',
]

const ENTERPRISE_FEATS = [
  'SSO / SAML',
  'Multi-jurisdiction governance',
  'Custom controls & workflows',
  'Unlimited users & teams',
  'Dedicated support & custom SLA',
]

const ENTERPRISE_REQS = [
  'SSO / SAML',
  'Multi-jurisdiction governance',
  'Custom controls & workflows',
  'Unlimited users & teams',
  'Dedicated support & custom SLA',
  'Other',
] as const

const SYSTEM_COUNT_OPTIONS = [
  { value: '', label: 'Select' },
  { value: '1-5', label: '1-5 systems' },
  { value: '6-20', label: '6-20 systems' },
  { value: '20-50', label: '20-50 systems' },
  { value: '50+', label: '50+ systems' },
] as const

const FAQS: { q: string; a: string[] }[] = [
  {
    q: 'Which plan is right for us?',
    a: [
      'Essentials suits teams standing up their first AI governance programme: registering systems, classifying risk and getting policies and evidence in place. Professional is built for organisations already running AI in production who need continuous monitoring, an unlimited system registry and API access. Enterprise is for organisations with SSO, multi-jurisdiction requirements or custom governance workflows that a fixed tier cannot accommodate.',
    ],
  },
  {
    q: 'Can we switch plans or billing frequency later?',
    a: [
      'Yes. You can move between Essentials, Professional and Enterprise, or switch between monthly and annual billing, at any time from Billing.',
    ],
  },
  {
    q: 'How is the Enterprise plan priced?',
    a: [
      'Enterprise is scoped to your organisation, based on the number of users, jurisdictions and systems you are governing, and any custom controls or workflows you need. Contact us and we will put together a quote and a short scoping call before anything is agreed.',
    ],
  },
  {
    q: 'What happens if we outgrow our plan limits?',
    a: [
      'If you are on Essentials and approaching your 5-system or 1-user limit, or on Professional and approaching your 15-seat limit, we will flag it before it becomes a blocker. You can add capacity or move to the next tier at that point. Nothing is locked or suspended automatically.',
    ],
  },
  {
    q: 'Is there a minimum contract, and can we cancel anytime?',
    a: [
      'Essentials and Professional have no minimum term. Cancel anytime, and you will keep access through the end of your current billing period. Annual plans are paid upfront for the year in exchange for the discount, then renew automatically unless cancelled beforehand. Enterprise is agreed on a bespoke contract with its own SLA, scoped during onboarding.',
    ],
  },
  {
    q: 'Can we see RegAnchor before subscribing?',
    a: [
      'Yes. Start with the free AI governance diagnostic to see how RegAnchor assesses your actual environment, or book a demo to walk through Essentials or Professional with our team. For Enterprise, a demo and scoping call are built into the quote process before any contract is agreed.',
    ],
  },
]

type CompareCell = boolean | string

type CompareRow =
  | { kind: 'group'; label: string }
  | {
      kind: 'feature'
      label: string
      badge?: string
      essentials: CompareCell
      professional: CompareCell
      enterprise: CompareCell
    }

const COMPARE_ROWS: CompareRow[] = [
  { kind: 'group', label: 'Registry and classification' },
  {
    kind: 'feature',
    label: 'AI asset registry',
    essentials: true,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'AI assets',
    essentials: '5',
    professional: 'Unlimited',
    enterprise: 'Unlimited',
  },
  {
    kind: 'feature',
    label: 'Risk assessment and classification (Annex III mapping)',
    essentials: true,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Provider and model tracking',
    essentials: true,
    professional: true,
    enterprise: true,
  },
  { kind: 'group', label: 'Governance and policy' },
  {
    kind: 'feature',
    label: 'Governance controls',
    essentials: true,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Policy management',
    essentials: true,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Custom controls and workflows',
    essentials: false,
    professional: false,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Multi-jurisdiction governance',
    essentials: false,
    professional: false,
    enterprise: true,
  },
  { kind: 'group', label: 'Evidence and audit' },
  {
    kind: 'feature',
    label: 'Evidence management (dossier snapshot)',
    essentials: true,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Governance status reports and dashboards',
    essentials: true,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Advanced evidence and audit history',
    essentials: false,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Auditor export',
    badge: 'New',
    essentials: false,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Custom evidence and reporting',
    essentials: false,
    professional: false,
    enterprise: true,
  },
  { kind: 'group', label: 'Monitoring and analytics' },
  {
    kind: 'feature',
    label: 'Basic usage and cost visibility',
    essentials: true,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Continuous monitoring',
    essentials: false,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Automated controls and testing',
    essentials: false,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Runtime and provider telemetry',
    essentials: false,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Usage, cost and model analytics',
    essentials: false,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Governance trend and benchmarking insights',
    essentials: false,
    professional: true,
    enterprise: true,
  },
  { kind: 'group', label: 'Connectivity' },
  {
    kind: 'feature',
    label: 'Connect your existing data sources',
    essentials: true,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'RegAnchor API access and integrations',
    essentials: false,
    professional: true,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Advanced integrations',
    essentials: false,
    professional: false,
    enterprise: true,
  },
  { kind: 'group', label: 'Access, security and support' },
  {
    kind: 'feature',
    label: 'Users',
    essentials: '1',
    professional: '15',
    enterprise: 'Unlimited',
  },
  {
    kind: 'feature',
    label: 'SSO / SAML',
    essentials: false,
    professional: false,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Advanced access controls',
    essentials: false,
    professional: false,
    enterprise: true,
  },
  {
    kind: 'feature',
    label: 'Support',
    essentials: 'Email',
    professional: 'Priority',
    enterprise: 'Dedicated + custom SLA',
  },
  {
    kind: 'feature',
    label: 'Dedicated onboarding',
    essentials: false,
    professional: false,
    enterprise: true,
  },
]

function Feat({ text }: { text: string }) {
  return (
    <div className={styles.feat}>
      <span className={styles.mark} aria-hidden>
        ✓
      </span>
      <span>{text}</span>
    </div>
  )
}

function CompareValue({ value }: { value: CompareCell }) {
  if (value === true) {
    return (
      <span className={styles.compareYes} aria-label="Included">
        ✓
      </span>
    )
  }
  if (value === false) {
    return (
      <span className={styles.compareNo} aria-label="Not included">
        –
      </span>
    )
  }
  return <span className={styles.compareText}>{value}</span>
}

function FeatureCompare() {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div className={styles.compareWrap}>
      <button
        type="button"
        className={open ? `${styles.compareBtn} ${styles.compareBtnOpen}` : styles.compareBtn}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Compare all features</span>
        <span className={styles.compareChevron} aria-hidden>
          <Icon icon={ChevronDown} size="sm" />
        </span>
      </button>
      <div className={styles.comparePanel} id={panelId} hidden={!open}>
        <div className={styles.compareScroll}>
          <table className={styles.compareTable}>
            <thead>
              <tr>
                <th scope="col" className={styles.compareFeatureHead}>
                  <span className={styles.srOnly}>Feature</span>
                </th>
                <th scope="col">Essentials</th>
                <th scope="col">Professional</th>
                <th scope="col">Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) =>
                row.kind === 'group' ? (
                  <tr key={`g-${row.label}`} className={styles.compareGroup}>
                    <th scope="colgroup" colSpan={4}>
                      {row.label}
                    </th>
                  </tr>
                ) : (
                  <tr key={row.label}>
                    <th scope="row" className={styles.compareFeature}>
                      {row.label}
                      {row.badge ? <span className={styles.compareBadge}>{row.badge}</span> : null}
                    </th>
                    <td>
                      <CompareValue value={row.essentials} />
                    </td>
                    <td>
                      <CompareValue value={row.professional} />
                    </td>
                    <td>
                      <CompareValue value={row.enterprise} />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function FaqItem({ q, a }: { q: string; a: string[] }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div className={open ? `${styles.faqRow} ${styles.faqOpen}` : styles.faqRow}>
      <button
        type="button"
        className={styles.faqTrigger}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.faqTitle}>{q}</span>
        <span className={styles.faqChevron} aria-hidden>
          <Icon icon={ChevronDown} size="sm" />
        </span>
      </button>
      <div className={styles.faqPanel} id={panelId} hidden={!open}>
        <div className={styles.faqBody}>
          {a.map((p) => (
            <p key={p.slice(0, 48)}>{p}</p>
          ))}
        </div>
      </div>
    </div>
  )
}

export function PlansPage() {
  const { org, user, profile, session, refreshOrg } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [annual, setAnnual] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [error, setError] = useState('')
  const [successNotice, setSuccessNotice] = useState('')
  const [showEnterprise, setShowEnterprise] = useState(false)
  const [entName, setEntName] = useState(profile?.full_name || '')
  const [entRole, setEntRole] = useState('')
  const [entSystems, setEntSystems] = useState('')
  const [entReqs, setEntReqs] = useState<string[]>([])
  const [entMessage, setEntMessage] = useState('')
  const [entBusy, setEntBusy] = useState(false)
  const [entDone, setEntDone] = useState(false)
  const [entError, setEntError] = useState('')
  const checkoutRef = useRef<StripeEmbeddedCheckout | null>(null)
  const mountRef = useRef<HTMLDivElement | null>(null)

  usePageChrome({ title: 'Plans', breadcrumbs: [{ label: 'Plans' }] })

  const plan = org?.plan || 'free'
  const isActive = org?.subscription_status === 'active'
  const period: StripePeriod = annual ? 'annual' : 'monthly'
  const ePrice = annual ? '1,290' : '129'
  const pPrice = annual ? '2,990' : '299'
  const per = annual ? '/year' : '/month'
  const eSave = annual ? 258 : 0
  const pSave = annual ? 598 : 0
  const essCurrent = plan === 'essentials' && isActive
  const proCurrent = plan === 'professional' && isActive

  useEffect(() => {
    const sub = searchParams.get('subscription')
    if (sub !== 'success') return
    const planName = searchParams.get('plan') || 'subscription'
    setSuccessNotice(
      `Subscription started${planName ? ` (${planName})` : ''}. Billing updates may take a moment to appear.`,
    )
    void refreshOrg()
    const next = new URLSearchParams(searchParams)
    next.delete('subscription')
    next.delete('plan')
    next.delete('session_id')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, refreshOrg])

  useEffect(() => {
    return () => {
      checkoutRef.current?.destroy()
      checkoutRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!checkoutOpen || !checkoutRef.current || !mountRef.current) return
    const el = mountRef.current
    el.innerHTML = ''
    checkoutRef.current.mount(el)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [checkoutOpen])

  function closeCheckout() {
    checkoutRef.current?.destroy()
    checkoutRef.current = null
    setCheckoutOpen(false)
  }

  async function subscribe(planKey: StripePlan) {
    setError('')
    setSuccessNotice('')
    const priceId = stripePriceId(planKey, period)
    const pk = stripePublishableKey()
    if (!priceId) {
      setError('Stripe price is not configured.')
      return
    }
    if (!pk) {
      setError('Stripe publishable key is missing.')
      return
    }
    if (!org?.id || !session?.access_token) {
      setError('Could not set up your organisation. Please refresh and try again.')
      return
    }
    setCheckoutBusy(planKey)
    try {
      const data = await invokeEdge<{
        clientSecret?: string
        url?: string
        error?: string
        existing?: boolean
      }>(
        'create-subscription-session',
        {
          price_id: priceId,
          org_id: org.id,
          embedded: true,
          return_origin: window.location.origin,
        },
        session.access_token,
      )
      if (data.existing) {
        setError('Your organisation already has an active subscription. Manage it from Billing.')
        return
      }
      if (data.error) {
        setError(data.error)
        return
      }
      if (!data.clientSecret) {
        setError('Could not start checkout.')
        return
      }

      const stripe = await loadStripe(pk)
      if (!stripe) {
        setError('Could not load Stripe.')
        return
      }

      checkoutRef.current?.destroy()
      checkoutRef.current = null

      const createEmbedded =
        'createEmbeddedCheckoutPage' in stripe && typeof stripe.createEmbeddedCheckoutPage === 'function'
          ? stripe.createEmbeddedCheckoutPage
          : (
              stripe as unknown as {
                initEmbeddedCheckout: (opts: { clientSecret: string }) => Promise<StripeEmbeddedCheckout>
              }
            ).initEmbeddedCheckout
      const checkout = await createEmbedded.call(stripe, { clientSecret: data.clientSecret })
      checkoutRef.current = checkout
      setCheckoutOpen(true)
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
    setEntReqs([])
    setEntMessage('')
    setEntError('')
    setEntDone(false)
    setShowEnterprise(true)
  }

  function toggleEntReq(value: string) {
    setEntReqs((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
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
        requirements: entReqs.length ? entReqs : null,
        message: entMessage.trim() || null,
      })
      if (insertErr) throw insertErr

      if (session?.access_token) {
        try {
          await invokeEdge(
            'send-mail',
            {
              kind: 'enterprise',
              name,
              email,
              role: entRole.trim() || undefined,
              organisation: orgName,
              company: orgName,
              systems: entSystems || undefined,
              system_count: entSystems || undefined,
              requirements: entReqs.length ? entReqs : undefined,
              message: entMessage.trim() || undefined,
            },
            session.access_token,
          )
        } catch (mailErr) {
          console.warn('Enterprise mail notification skipped', mailErr)
        }
      }

      if (org?.id && user?.id) {
        await sb.from('registry_audit_log').insert({
          org_id: org.id,
          user_id: user.id,
          action: 'enterprise_inquiry',
          entity_type: 'organisation',
          entity_id: org.id,
          changes: { _actor_name: profile?.full_name || email, requirements: entReqs },
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
        { id: 'checkout', label: 'Checkout' },
        { id: 'faq', label: 'FAQ' },
      ]}
    >
      <PageHeader
        title="Subscription plans"
        description="Choose the governance tier that matches your organisation."
        actions={
          <div className={styles.period} role="group" aria-label="Billing period">
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

      {error ? (
        <Notice tone="risk" title="Checkout">
          {error}
        </Notice>
      ) : null}
      {successNotice ? <Notice title="Subscription">{successNotice}</Notice> : null}

      <Section id="pricing" title="Plans">
        <div className={styles.grid}>
          <article className={essCurrent ? `${styles.card} ${styles.cardCurrent}` : styles.card}>
            <div className={styles.head}>
              <div className={styles.tier}>Essentials</div>
            </div>
            <div className={styles.name}>Foundation</div>
            <p className={styles.desc}>Governance foundation for teams putting AI into production.</p>
            <div className={styles.price}>
              <span className={styles.currency}>{'\u00A3'}</span>
              <span className={styles.num}>{ePrice}</span>
              <span className={styles.per}>{per}</span>
            </div>
            <div className={styles.save}>{eSave ? `Save ${'\u00A3'}${eSave}/yr` : '\u00A0'}</div>
            <div className={styles.rule} aria-hidden />
            <div className={styles.feats}>
              {ESSENTIALS_FEATS.map((f) => (
                <Feat key={f} text={f} />
              ))}
            </div>
            {essCurrent ? (
              <div className={styles.current}>Current plan</div>
            ) : isActive ? (
              <Button variant="ghost" onClick={() => navigate('/billing')}>
                Manage in Billing
              </Button>
            ) : (
              <Button pending={checkoutBusy === 'essentials'} onClick={() => void subscribe('essentials')}>
                Get started
              </Button>
            )}
          </article>

          <article className={proCurrent ? `${styles.card} ${styles.cardCurrent}` : styles.card}>
            <div className={styles.head}>
              <div className={styles.tier}>Professional</div>
            </div>
            <div className={styles.name}>Operations</div>
            <p className={styles.desc}>Continuous governance for organisations operating AI at scale.</p>
            <div className={styles.price}>
              <span className={styles.currency}>{'\u00A3'}</span>
              <span className={styles.num}>{pPrice}</span>
              <span className={styles.per}>{per}</span>
            </div>
            <div className={styles.save}>{pSave ? `Save ${'\u00A3'}${pSave}/yr` : '\u00A0'}</div>
            <div className={styles.rule} aria-hidden />
            <div className={styles.feats}>
              {PROFESSIONAL_FEATS.map((f) => (
                <Feat key={f} text={f} />
              ))}
            </div>
            {proCurrent ? (
              <div className={styles.current}>Current plan</div>
            ) : isActive ? (
              <Button variant="ghost" onClick={() => navigate('/billing')}>
                Manage in Billing
              </Button>
            ) : (
              <Button
                pending={checkoutBusy === 'professional'}
                onClick={() => void subscribe('professional')}
              >
                Start Professional
              </Button>
            )}
          </article>

          <article className={styles.card}>
            <div className={styles.head}>
              <div className={styles.tier}>Enterprise</div>
            </div>
            <div className={styles.name}>Infrastructure</div>
            <p className={styles.desc}>Governance infrastructure for complex AI environments.</p>
            <div className={styles.price}>
              <span className={styles.numWide}>Bespoke</span>
            </div>
            <div className={styles.save}>Tailored to your organisation</div>
            <div className={styles.rule} aria-hidden />
            <div className={styles.feats}>
              {ENTERPRISE_FEATS.map((f) => (
                <Feat key={f} text={f} />
              ))}
            </div>
            <Button variant="ghost" onClick={openEnterprise}>
              Talk to us
            </Button>
          </article>
        </div>
      </Section>

      <Section id="compare">
        <FeatureCompare />
      </Section>

      {checkoutOpen ? (
        <Section id="checkout" title="Complete your subscription">
          <div className={styles.checkoutHead}>
            <p className={styles.checkoutHint}>Secure payment powered by Stripe.</p>
            <Button variant="ghost" size="sm" onClick={closeCheckout}>
              Cancel
            </Button>
          </div>
          <div className={styles.checkoutMount} ref={mountRef} />
        </Section>
      ) : null}

      <section id="faq" className={styles.faqBlock} aria-labelledby="plans-faq-title">
        <div className={styles.faqCopy}>
          <h2 id="plans-faq-title" className={styles.faqBlockTitle}>
            Pricing FAQ
          </h2>
          <p className={styles.faqBlockDesc}>
            Common questions about plans, billing and upgrades.
          </p>
        </div>
        <div className={styles.faqBodyWrap}>
          <div className={styles.faq}>
            {FAQS.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      </section>

      {showEnterprise ? (
        <Drawer
          open={showEnterprise}
          title="Enterprise inquiry"
          description="Tell us about your organisation and requirements."
          onClose={() => setShowEnterprise(false)}
          footer={
            entDone ? (
              <Button size="sm" onClick={() => setShowEnterprise(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => setShowEnterprise(false)}>
                  Cancel
                </Button>
                <Button size="sm" pending={entBusy} onClick={() => void submitEnterprise()}>
                  Submit inquiry
                </Button>
              </>
            )
          }
        >
          {entDone ? (
            <EmptyState
              title="Inquiry received"
              body={`Thank you, ${entName.split(' ')[0] || 'there'}. A RegAnchor governance specialist will be in touch within 24 hours.`}
            />
          ) : (
            <div className={styles.entForm}>
              <p className={styles.entInset}>
                Enterprise plans include unlimited users, multi-department workspaces, dedicated advisory,
                on-site sessions, and custom SLA. We respond within 24 hours.
              </p>
              <label className={styles.field}>
                Full name
                <input
                  className={styles.input}
                  value={entName}
                  onChange={(e) => setEntName(e.target.value)}
                  autoComplete="name"
                />
              </label>
              <label className={styles.field}>
                Role / title
                <input
                  className={styles.input}
                  value={entRole}
                  onChange={(e) => setEntRole(e.target.value)}
                  placeholder="e.g. Head of Risk, CTO"
                  autoComplete="organization-title"
                />
              </label>
              <div className={styles.entRow}>
                <label className={styles.field}>
                  Email
                  <input className={styles.input} value={user?.email || ''} disabled />
                </label>
                <label className={styles.field}>
                  Organisation
                  <input className={styles.input} value={org?.name || ''} disabled />
                </label>
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Number of AI assets</span>
                <SelectMenu
                  aria-label="Number of AI assets"
                  value={entSystems}
                  onChange={setEntSystems}
                  options={SYSTEM_COUNT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  placeholder="Select"
                />
              </div>
              <fieldset className={styles.entReqs}>
                <legend className={styles.entLegend}>What are you looking for?</legend>
                <div className={styles.entReqGrid}>
                  {ENTERPRISE_REQS.map((req) => (
                    <label key={req} className={styles.entCheck}>
                      <input
                        type="checkbox"
                        checked={entReqs.includes(req)}
                        onChange={() => toggleEntReq(req)}
                      />
                      <span>{req}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className={styles.field}>
                Tell us more about your requirements
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={entMessage}
                  onChange={(e) => setEntMessage(e.target.value)}
                  placeholder="Describe your governance needs, number of departments, jurisdictions, or any specific requirements…"
                />
              </label>
              {entError ? <Notice tone="risk">{entError}</Notice> : null}
            </div>
          )}
        </Drawer>
      ) : null}
    </PageFrame>
  )
}
