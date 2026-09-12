import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { clsx } from 'clsx'
import styles from './Button.module.css'

type Variant = 'primary' | 'ghost'
/** md = page / header actions (~32px). sm = dense forms, keys, drawers, row actions (~28px). */
type Size = 'sm' | 'md'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  pending?: boolean
  selected?: boolean
  children: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  pending = false,
  selected = false,
  className,
  disabled,
  children,
  ...rest
}: Props) {
  const isDisabled = disabled || pending
  return (
    <button
      type="button"
      className={clsx(
        styles.btn,
        variant === 'ghost' ? styles.ghost : styles.primary,
        size === 'sm' && styles.sm,
        pending && styles.pending,
        selected && styles.selected,
        className,
      )}
      disabled={isDisabled}
      aria-busy={pending || undefined}
      aria-pressed={selected || undefined}
      {...rest}
    >
      {children}
    </button>
  )
}
