import { NavLink } from 'react-router-dom'
import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'
import { useShellChrome } from './shellChrome'
import { Icon } from './Icon'
import styles from './Breadcrumbs.module.css'

/**
 * Stable top-left location. Root pages show a single crumb (e.g. Registry);
 * nested trails append after it. No section icons — sidebar owns those.
 */
export function Breadcrumbs() {
  const { breadcrumbs } = useShellChrome()
  if (!breadcrumbs.length) return null

  return (
    <nav className={styles.trail} aria-label="Breadcrumb">
      <ol className={styles.list}>
        {breadcrumbs.map((crumb, i) => {
          const last = i === breadcrumbs.length - 1
          return (
            <Fragment key={`${crumb.label}-${i}`}>
              {i > 0 ? (
                <li className={styles.sep} aria-hidden>
                  <Icon icon={ChevronRight} size="sm" />
                </li>
              ) : null}
              <li className={styles.item}>
                {crumb.to && !last ? (
                  <NavLink to={crumb.to} className={styles.link}>
                    {crumb.label}
                  </NavLink>
                ) : (
                  <span className={styles.current} aria-current={last ? 'page' : undefined}>
                    {crumb.label}
                  </span>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
