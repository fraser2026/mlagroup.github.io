import { clsx } from 'clsx'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemePreference } from '../theme/ThemeProvider'
import { Icon } from './Icon'
import styles from './ThemePicker.module.css'

const OPTIONS: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
]

type Props = {
  /** Compact segmented control for the context rail. */
  compact?: boolean
  className?: string
}

export function ThemePicker({ compact = false, className }: Props) {
  const { preference, setPreference } = useTheme()

  return (
    <div
      className={clsx(styles.wrap, compact && styles.compact, className)}
      role="group"
      aria-label="Appearance"
    >
      {OPTIONS.map((opt) => {
        const on = preference === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            className={clsx(styles.option, on && styles.on)}
            aria-pressed={on}
            onClick={() => setPreference(opt.id)}
          >
            <Icon icon={opt.icon} size="sm" />
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
