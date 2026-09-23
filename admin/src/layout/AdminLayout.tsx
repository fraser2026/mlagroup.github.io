import { AppShell, PageTransition, type NavGroup, type NavItem } from '@ra/ui'
import { ShellChromeProvider } from '@ra/ui/shellChrome'
import { useMlaAuth } from '../auth/MlaAuthProvider'
import { ClipboardList, FileQuestion, FileStack, Gauge, GitBranch, Home, HelpCircle, History, Scale, ScrollText } from 'lucide-react'

const topItems: NavItem[] = [{ to: '/', label: 'Overview', icon: Home as NavItem['icon'], end: true }]

const groups: NavGroup[] = [
  {
    id: 'methodology',
    label: 'Methodology',
    defaultOpen: true,
    items: [
      { to: '/controls', label: 'Controls', icon: ClipboardList as NavItem['icon'] },
      { to: '/frameworks', label: 'Frameworks', icon: FileStack as NavItem['icon'] },
      { to: '/mappings', label: 'Mappings', icon: GitBranch as NavItem['icon'] },
      { to: '/policies', label: 'Policy templates', icon: ScrollText as NavItem['icon'] },
      { to: '/methodology-versions', label: 'Versions', icon: History as NavItem['icon'] },
    ],
  },
  {
    id: 'engines',
    label: 'Engines',
    defaultOpen: true,
    items: [
      { to: '/diagnostic-scoring', label: 'Diagnostic scoring', icon: Gauge as NavItem['icon'] },
      { to: '/diagnostic-regs', label: 'Diagnostic regs', icon: Scale as NavItem['icon'] },
      { to: '/diagnostic-questions', label: 'Diagnostic questions', icon: FileQuestion as NavItem['icon'] },
      { to: '/assessment-questions', label: 'Asset assessment questions', icon: HelpCircle as NavItem['icon'] },
    ],
  },
]

export function AdminLayout() {
  const { profile, signOut } = useMlaAuth()
  const label = profile?.full_name || profile?.email || 'MLA admin'

  return (
    <ShellChromeProvider>
      <AppShell
        title="Control Centre"
        userLabel={label}
        topItems={topItems}
        groups={groups}
        onSignOut={() => void signOut()}
      >
        <PageTransition />
      </AppShell>
    </ShellChromeProvider>
  )
}
