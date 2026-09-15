import { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  Boxes,
  Building2,
  ClipboardList,
  FileText,
  LayoutGrid,
  ListChecks,
  Plug,
  ScrollText,
  Search,
  Settings,
  Shield,
  KeyRound,
  Database,
  Fingerprint,
  ShieldCheck,
} from 'lucide-react'
import { Icon } from './Icon'
import { useOverlayScrollLock } from './useOverlayScrollLock'
import { sb } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { loadWorkspace } from '../lib/workspace'
import styles from './CommandPalette.module.css'

type AssetHit = { id: string; name: string }

const NAV = [
  { to: '/', label: 'Home', icon: LayoutGrid },
  { to: '/setup', label: 'Getting started', icon: ListChecks },
  { to: '/registry', label: 'Registry', icon: Boxes },
  { to: '/frameworks', label: 'Frameworks', icon: Shield },
  { to: '/controls', label: 'Controls', icon: ClipboardList },
  { to: '/policies', label: 'Policies', icon: ScrollText },
  { to: '/integrations', label: 'Connect', icon: Plug },
  { to: '/api-keys', label: 'API keys', icon: KeyRound },
  { to: '/authentication', label: 'Authentication', icon: Fingerprint },
  { to: '/auditor-access', label: 'Auditor access', icon: ShieldCheck },
  { to: '/data-backends', label: 'Data backends', icon: Database },
  { to: '/monitoring', label: 'Monitoring', icon: Activity },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/reports#dossier', label: 'Governance dossier', icon: FileText },
  { to: '/organisation', label: 'Organisation', icon: Building2 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [query, setQuery] = useState('')
  const [assets, setAssets] = useState<AssetHit[]>([])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  useOverlayScrollLock(open)

  useEffect(() => {
    if (!open || !session?.user) return
    let cancelled = false
    async function load() {
      const ws = await loadWorkspace(session!.user.id)
      if (!ws.orgId) return
      const { data } = await sb
        .from('ai_systems')
        .select('id,name')
        .eq('org_id', ws.orgId)
        .is('deleted_at', null)
        .order('name')
        .limit(40)
      if (!cancelled) setAssets((data as AssetHit[]) || [])
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, session])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return assets.slice(0, 8)
    return assets.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 8)
  }, [assets, query])

  function go(to: string) {
    onOpenChange(false)
    navigate(to)
  }

  if (!open) return null

  return (
    <div className={styles.overlay} data-ra-overlay-root="" onClick={() => onOpenChange(false)}>
      <Command
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        label="Command palette"
        shouldFilter={false}
      >
        <div className={styles.inputRow}>
          <Icon icon={Search} size="sm" className={styles.searchIcon} />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Jump to a page or asset…"
            className={styles.input}
            autoFocus
          />
          <kbd className={styles.kbd}>esc</kbd>
        </div>
        <Command.List className={styles.list} data-ra-scroll="overlay">
          <Command.Empty className={styles.empty}>No matches</Command.Empty>
          <Command.Group heading="Navigate" className={styles.group}>
            {NAV.filter((n) => !query || n.label.toLowerCase().includes(query.toLowerCase())).map((n) => (
              <Command.Item key={n.to} value={n.label} onSelect={() => go(n.to)} className={styles.item}>
                <Icon icon={n.icon} size="sm" />
                <span>{n.label}</span>
              </Command.Item>
            ))}
          </Command.Group>
          {filteredAssets.length ? (
            <Command.Group heading="Registry" className={styles.group}>
              {filteredAssets.map((a) => (
                <Command.Item
                  key={a.id}
                  value={`asset ${a.name}`}
                  onSelect={() => go(`/registry/${a.id}`)}
                  className={styles.item}
                >
                  <Icon icon={Boxes} size="sm" />
                  <span>{a.name}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
        </Command.List>
      </Command>
    </div>
  )
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false)
  return { open, setOpen, openPalette: () => setOpen(true) }
}
