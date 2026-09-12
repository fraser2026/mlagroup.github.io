import { clsx } from 'clsx'
import styles from './BrandLoader.module.css'

type Props = {
  /** Accessible label (visually hidden). */
  label?: string
  /** Fill the parent and centre the mark (page / panel load). */
  fill?: boolean
  /** Centre in the viewport (auth / bridge gates). */
  viewport?: boolean
  /** Compact mark for tight chrome; default is page-scale. */
  size?: 'md' | 'lg'
  className?: string
}

/** Quiet RA monogram pulse — Stripe-style presence without spinner chrome. */
export function BrandLoader({
  label = 'Loading',
  fill = false,
  viewport = false,
  size = 'lg',
  className,
}: Props) {
  return (
    <div
      className={clsx(styles.wrap, fill && styles.fill, viewport && styles.viewport, className)}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <svg
        className={clsx(styles.mark, size === 'md' ? styles.md : styles.lg)}
        viewBox="0 0 85.28 54"
        aria-hidden
      >
        <path d="M13.14,37h-.14v17H0V0h15.19c12.2,0,23.81,3.98,23.81,18.31,0,7.96-5.33,13.25-12.12,16l14.31,19.69h-15.94l-12.11-17ZM13,12v15h3.32c5.7,0,9.66-2.88,9.66-7.93,0-4.69-3.39-7.07-9.81-7.07h-3.17Z" />
        <path d="M64.36,0h-12.74l-20.92,54h13.46l13.83-13.15,13.41,13.15h13.88L64.36,0ZM49.82,37.9c3.24-8.89,6.81-18.71,8.03-22.05,1.17,3.25,4.71,13.09,7.92,22.01-4.68-3.6-11.27-3.58-15.95.04Z" />
      </svg>
    </div>
  )
}
