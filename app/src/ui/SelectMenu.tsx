import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { Icon } from './Icon'
import styles from './SelectMenu.module.css'

export type SelectOption = {
  value: string
  label: string
  icon?: ReactNode
  disabled?: boolean
}

export type SelectOptionGroup = {
  label: string
  options: SelectOption[]
}

type Props = {
  value: string
  options?: SelectOption[]
  groups?: SelectOptionGroup[]
  placeholder?: string
  disabled?: boolean
  onChange: (value: string) => void
  className?: string
  'aria-label'?: string
}

function flatten(options: SelectOption[] | undefined, groups: SelectOptionGroup[] | undefined) {
  if (groups?.length) return groups.flatMap((g) => g.options)
  return options || []
}

function menuPlacement(trigger: HTMLElement): CSSProperties {
  const r = trigger.getBoundingClientRect()
  const spaceBelow = window.innerHeight - r.bottom - 12
  const maxH = Math.min(280, Math.max(120, spaceBelow))
  const openUp = spaceBelow < 160 && r.top > spaceBelow
  return {
    left: Math.round(r.left),
    width: Math.round(r.width),
    maxHeight: maxH,
    ...(openUp
      ? { bottom: Math.round(window.innerHeight - r.top + 6), top: 'auto' }
      : { top: Math.round(r.bottom + 6), bottom: 'auto' }),
  }
}

export function SelectMenu({
  value,
  options,
  groups,
  placeholder = 'Select',
  disabled = false,
  onChange,
  className,
  'aria-label': ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const all = flatten(options, groups)
  const selected = all.find((o) => o.value === value)

  function close() {
    setOpen(false)
    setMenuStyle(null)
  }

  function openMenu() {
    const trigger = rootRef.current
    if (!trigger || disabled) return
    setMenuStyle(menuPlacement(trigger))
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    function place() {
      const trigger = rootRef.current
      if (!trigger) return
      setMenuStyle(menuPlacement(trigger))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
      close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const menu =
    open && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            className={styles.menu}
            data-ra-scroll="canvas"
            role="listbox"
            id={listId}
            aria-label={ariaLabel || placeholder}
            style={menuStyle}
          >
            {groups?.length
              ? groups.map((g) => (
                  <div key={g.label} className={styles.group}>
                    <div className={styles.groupLabel}>{g.label}</div>
                    {g.options.map((o) => (
                      <OptionRow
                        key={o.value || `${g.label}-empty`}
                        option={o}
                        active={o.value === value}
                        onPick={() => {
                          if (o.disabled) return
                          onChange(o.value)
                          close()
                        }}
                      />
                    ))}
                  </div>
                ))
              : (options || []).map((o) => (
                  <OptionRow
                    key={o.value || 'empty'}
                    option={o}
                    active={o.value === value}
                    onPick={() => {
                      if (o.disabled) return
                      onChange(o.value)
                      close()
                    }}
                  />
                ))}
          </div>,
          document.body,
        )
      : null

  return (
    <div className={clsx(styles.root, className)} ref={rootRef}>
      <button
        type="button"
        className={clsx(styles.trigger, open && styles.triggerOpen, disabled && styles.triggerDisabled)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => {
          if (disabled) return
          if (open) close()
          else openMenu()
        }}
      >
        <span className={styles.triggerInner}>
          {selected?.icon ? <span className={styles.triggerIcon}>{selected.icon}</span> : null}
          <span className={clsx(styles.triggerLabel, !selected && styles.placeholder)}>
            {selected?.label || placeholder}
          </span>
        </span>
        <Icon icon={ChevronDown} size="sm" className={styles.chevron} />
      </button>
      {menu}
    </div>
  )
}

function OptionRow({
  option,
  active,
  onPick,
}: {
  option: SelectOption
  active: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      disabled={option.disabled}
      className={clsx(styles.option, active && styles.optionActive, option.disabled && styles.optionDisabled)}
      onClick={onPick}
    >
      {option.icon ? <span className={styles.optionIcon}>{option.icon}</span> : null}
      <span className={styles.optionLabel}>{option.label}</span>
    </button>
  )
}
