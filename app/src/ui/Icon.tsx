import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { clsx } from 'clsx'
import type { LucideIcon } from 'lucide-react'
import styles from './Icon.module.css'

type Size = 'sm' | 'md'

type Props = {
  icon: LucideIcon
  size?: Size
  className?: string
  label?: string
} & Omit<ComponentPropsWithoutRef<'svg'>, 'children' | 'color' | 'width' | 'height'>

export const Icon = forwardRef<SVGSVGElement, Props>(function Icon(
  { icon: Cmp, size = 'md', className, label, ...rest },
  ref,
) {
  const px = size === 'sm' ? 16 : 18
  return (
    <Cmp
      ref={ref}
      className={clsx(styles.icon, className)}
      width={px}
      height={px}
      strokeWidth={1.75}
      absoluteStrokeWidth
      aria-hidden={label ? undefined : true}
      aria-label={label}
      {...rest}
    />
  )
})
