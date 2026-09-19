/**
 * Mirror of js/stripe-config.js — live catalog prices for checkout.
 * Test mode uses plan-slug tokens the edge function resolves.
 */
const LIVE_PRICES = {
  diagnostic: 'price_1T6iCTRfSQTwpCt9sEdFA1Qy',
  essentials: {
    monthly: 'price_1TD37VRfSQTwpCt9fmlCcuQh',
    annual: 'price_1TD37VRfSQTwpCt914LUfLrf',
  },
  professional: {
    monthly: 'price_1UF1yPRfSQTwpCt9ssDdo6uQ',
    annual: 'price_1UF1zvRfSQTwpCt9rcSPUtkN',
  },
} as const

const LIVE_PK =
  'pk_live_51SVuGRRfSQTwpCt9hCFdOOyVJBOLgV1Gss5CxMOry1T3kKW3cE7IF8OhQzvXjBd9IjOCp941p4uc9R8RPolEvRVV00fiMjUyXQ'
const TEST_PK = ''

export type StripePlan = 'essentials' | 'professional'
export type StripePeriod = 'monthly' | 'annual'

/** Keep in sync with js/stripe-config.js `mode`. */
export const STRIPE_MODE: 'test' | 'live' = 'live'

export function stripePublishableKey(): string {
  return STRIPE_MODE === 'test' ? TEST_PK : LIVE_PK
}

export function stripePriceId(plan: StripePlan, period: StripePeriod = 'monthly'): string | null {
  if (STRIPE_MODE === 'test') {
    return `test:${plan}:${period}`
  }
  const p = LIVE_PRICES[plan]
  return p ? p[period] : null
}

export const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  essentials: 'Essentials',
  professional: 'Professional',
  enterprise: 'Enterprise',
}

export const MEMBER_ROLE_LABELS: Record<string, string> = {
  owner: 'Workspace admin',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
  member: 'Member',
}
