import type { HTMLAttributes, ReactNode } from 'react'
import { clsx } from 'clsx'

type Props = {
  children: ReactNode
  className?: string
  as?: 'span' | 'div'
} & Omit<HTMLAttributes<HTMLElement>, 'children' | 'className'>

/**
 * Metric numeral — portal Inter + tabular figures.
 * Use for scores, percentages, counts, and date digits.
 */
export function RaNum({ children, className, as: Tag = 'span', ...rest }: Props) {
  return (
    <Tag className={clsx('ra-num', className)} {...rest}>
      {children}
    </Tag>
  )
}
