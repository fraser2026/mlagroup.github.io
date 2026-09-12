import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'ra_context_rail'
/** Match ContextRail CSS: rail is hidden at max-width 1100px. */
const RAIL_DESKTOP_MQ = '(min-width: 1101px)'

type ShellChromeValue = {
  railOpen: boolean
  setRailOpen: (open: boolean) => void
  /** Open/close for the current page only; does not write localStorage. */
  setRailOpenSession: (open: boolean) => void
  toggleRail: () => void
  /** False on ledger/list pages that should not steal width for On this page */
  railAvailable: boolean
  setRailAvailable: (available: boolean) => void
  breadcrumbs: Breadcrumb[]
  setBreadcrumbs: (items: Breadcrumb[]) => void
  pageTitle: string | null
  setPageTitle: (title: string | null) => void
}

export type Breadcrumb = {
  label: string
  to?: string
}

const ShellChromeContext = createContext<ShellChromeValue | null>(null)

function readRailPreference(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    // Closed by default so list pages stay wide; long-form pages opt in with openRail.
    if (raw === null) return false
    return raw === '1'
  } catch {
    return false
  }
}

function isRailDesktop() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(RAIL_DESKTOP_MQ).matches
}

export function ShellChromeProvider({ children }: { children: ReactNode }) {
  const [railOpen, setRailOpenState] = useState(readRailPreference)
  const [railAvailable, setRailAvailable] = useState(false)
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([])
  const [pageTitle, setPageTitle] = useState<string | null>(null)

  const setRailOpen = useCallback((open: boolean) => {
    setRailOpenState(open)
    try {
      localStorage.setItem(STORAGE_KEY, open ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const setRailOpenSession = useCallback((open: boolean) => {
    setRailOpenState(open)
  }, [])

  const toggleRail = useCallback(() => {
    setRailOpen(!railOpen)
  }, [railOpen, setRailOpen])

  const value = useMemo(
    () => ({
      railOpen,
      setRailOpen,
      setRailOpenSession,
      toggleRail,
      railAvailable,
      setRailAvailable,
      breadcrumbs,
      setBreadcrumbs,
      pageTitle,
      setPageTitle,
    }),
    [railOpen, setRailOpen, setRailOpenSession, toggleRail, railAvailable, breadcrumbs, pageTitle],
  )

  return <ShellChromeContext.Provider value={value}>{children}</ShellChromeContext.Provider>
}

export function useShellChrome() {
  const ctx = useContext(ShellChromeContext)
  if (!ctx) throw new Error('useShellChrome requires ShellChromeProvider')
  return ctx
}

/** Pages declare chrome title / crumbs; clears on unmount.
 *  openRail: desktop-only session open for long-form pages (e.g. control detail). Does not persist.
 */
export function usePageChrome(opts: {
  title?: string
  breadcrumbs?: Breadcrumb[]
  /** Open “On this page” on desktop while mounted. Mobile stays closed. Not for list pages. */
  openRail?: boolean
}) {
  const { setPageTitle, setBreadcrumbs, setRailOpenSession } = useShellChrome()
  const crumbKey = JSON.stringify(opts.breadcrumbs ?? [])

  useEffect(() => {
    setPageTitle(opts.title ?? null)
    setBreadcrumbs(opts.breadcrumbs ?? [])
    return () => {
      setPageTitle(null)
      setBreadcrumbs([])
    }
    // crumbKey captures breadcrumbs by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.title, crumbKey, setPageTitle, setBreadcrumbs])

  useEffect(() => {
    if (!opts.openRail) return
    if (!isRailDesktop()) return

    const previous = readRailPreference()
    setRailOpenSession(true)
    return () => {
      setRailOpenSession(previous)
    }
  }, [opts.openRail, setRailOpenSession])
}
