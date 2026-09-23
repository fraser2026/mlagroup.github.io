import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

function rememberEnabled() {
  try {
    return localStorage.getItem('ra_remember') !== '0'
  } catch {
    return true
  }
}

function authStorage(): Storage {
  return {
    getItem(key) {
      try {
        return (rememberEnabled() ? localStorage : sessionStorage).getItem(key)
      } catch {
        return null
      }
    },
    setItem(key, value) {
      try {
        const primary = rememberEnabled() ? localStorage : sessionStorage
        const other = rememberEnabled() ? sessionStorage : localStorage
        primary.setItem(key, value)
        other.removeItem(key)
      } catch {
        /* ignore */
      }
    },
    removeItem(key) {
      try {
        localStorage.removeItem(key)
        sessionStorage.removeItem(key)
      } catch {
        /* ignore */
      }
    },
    get length() {
      return 0
    },
    clear() {},
    key() {
      return null
    },
  }
}

export function setRememberPreference(remember: boolean) {
  try {
    localStorage.setItem('ra_remember', remember ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: authStorage(),
  },
})
