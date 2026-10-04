import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'ra_theme'

type ThemeContextValue = {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (next: ThemePreference) => void
  /**
   * Auth surfaces (login / invite): paint from the OS only.
   * Does not change the stored in-app preference.
   */
  setAuthSurface: (active: boolean) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    /* ignore */
  }
  return 'light'
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference
}

function applyDomTheme(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readPreference())
  const [authSurface, setAuthSurfaceState] = useState(false)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => {
    // Match index.html FOUC: auth routes always follow the device.
    if (typeof window !== 'undefined') {
      const path = window.location.pathname || ''
      if (path === '/login' || path === '/invite' || path.startsWith('/invite/')) {
        return systemTheme()
      }
    }
    return resolve(readPreference())
  })

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const setAuthSurface = useCallback((active: boolean) => {
    setAuthSurfaceState(active)
  }, [])

  useEffect(() => {
    const next = authSurface ? systemTheme() : resolve(preference)
    setResolved(next)
    applyDomTheme(next)
  }, [preference, authSurface])

  useEffect(() => {
    if (!authSurface && preference !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const next = systemTheme()
      setResolved(next)
      applyDomTheme(next)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [preference, authSurface])

  const value = useMemo(
    () => ({ preference, resolved, setPreference, setAuthSurface }),
    [preference, resolved, setPreference, setAuthSurface],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme requires ThemeProvider')
  return ctx
}

/** Lock login / invite to the device color scheme while mounted. */
export function useAuthSurfaceTheme(): ResolvedTheme {
  const { resolved, setAuthSurface } = useTheme()
  useEffect(() => {
    setAuthSurface(true)
    return () => setAuthSurface(false)
  }, [setAuthSurface])
  return resolved
}

export function authWordmarkSrc(resolved: ResolvedTheme): string {
  return resolved === 'dark' ? '/wordmark-light.svg' : '/wordmark.svg'
}
