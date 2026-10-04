import { AppShell, type NavGroup, type NavItem } from '../ui/AppShell'
import { ShellChromeProvider } from '../ui/shellChrome'
import { PageTransition } from '../ui/PageTransition'
import { CommandPalette, useCommandPalette } from '../ui/CommandPalette'
import { useAuth } from '../auth/AuthProvider'
import { clearAccountChipCache, resolveAccountChip } from '../lib/accountLabel'
import {
  Activity,
  Bell,
  Boxes,
  Building2,
  ClipboardList,
  CreditCard,
  FileText,
  KeyRound,
  ListChecks,
  ListTodo,
  Plug,
  ScrollText,
  Settings,
  Shield,
  Users,
  Database,
  Fingerprint,
  ShieldCheck,
} from 'lucide-react'

const topItems: NavItem[] = [
  { to: '/registry', label: 'Registry', icon: Boxes },
  { to: '/integrations', label: 'Connect', icon: Plug },
  { to: '/reports', label: 'Reports', icon: FileText },
]

const groups: NavGroup[] = [
  {
    id: 'governance',
    label: 'Governance',
    defaultOpen: true,
    items: [
      { to: '/controls', label: 'Controls', icon: ClipboardList },
      { to: '/policies', label: 'Policies', icon: ScrollText },
      { to: '/frameworks', label: 'Frameworks', icon: Shield },
      { to: '/organisation', label: 'Organisation', icon: Building2 },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    defaultOpen: false,
    items: [
      { to: '/api-keys', label: 'API keys', icon: KeyRound },
      { to: '/authentication', label: 'Authentication', icon: Fingerprint },
      { to: '/data-backends', label: 'Data backends', icon: Database },
      { to: '/users', label: 'Users', icon: Users },
      { to: '/auditor-access', label: 'Auditor access', icon: ShieldCheck },
      { to: '/billing', label: 'Billing', icon: CreditCard },
      { to: '/plans', label: 'Subscription', icon: CreditCard },
      { to: '/alerts', label: 'Notifications', icon: Bell },
      { to: '/monitoring', label: 'Audit trail', icon: Activity },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    defaultOpen: false,
    items: [
      { to: '/my-work', label: 'My work', icon: ListTodo },
      { to: '/setup', label: 'Getting started', icon: ListChecks },
    ],
  },
]

export function AppLayout() {
  const { user, profile, orgReady, signOut } = useAuth()
  const meta = user?.user_metadata || {}
  const metaFirst = typeof meta.first_name === 'string' ? meta.first_name : null
  const metaLast = typeof meta.last_name === 'string' ? meta.last_name : null
  const metaName = typeof meta.full_name === 'string' ? meta.full_name : null
  const email = profile?.email || user?.email || null
  // Session email is available before profiles name — never paint the
  // email local-part (e.g. "admin") until org/profile hydrate finishes.
  const chip = resolveAccountChip({
    userId: user?.id,
    firstName: profile?.first_name || metaFirst,
    lastName: profile?.last_name || metaLast,
    fullName: profile?.full_name || metaName,
    email,
    profileReady: orgReady,
  })
  const { open, setOpen, openPalette } = useCommandPalette()

  return (
    <ShellChromeProvider>
      <AppShell
        title="RegAnchor"
        userLabel={chip.label || undefined}
        userInitials={chip.initials || undefined}
        userPending={chip.pending}
        userEmail={email ?? undefined}
        topItems={topItems}
        groups={groups}
        onSignOut={async () => {
          clearAccountChipCache()
          await signOut()
          window.location.href = '/login'
        }}
        onOpenCommand={openPalette}
      >
        <PageTransition />
      </AppShell>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </ShellChromeProvider>
  )
}
