import { Outlet, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import styles from './PageTransition.module.css'

export function PageTransition() {
  const location = useLocation()
  const reduce = useReducedMotion()

  return (
    <motion.div
      key={location.pathname}
      className={styles.wrap}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <Outlet />
    </motion.div>
  )
}
