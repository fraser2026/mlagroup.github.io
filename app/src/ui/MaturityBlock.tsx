import { maturityLevel, maturityLabel } from '../lib/registry'
import styles from './MaturityBlock.module.css'

type Props = {
  score: number | null | undefined
  mini?: boolean
}

const LEVEL_CODES = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'] as const

function rowMod(i: number, current: number): string {
  if (i === current) return styles.rowCurrent
  if (current < 0) return ''
  if (i < current) {
    const dist = Math.min(i + 1, 3)
    if (dist === 1) return styles.achieved1
    if (dist === 2) return styles.achieved2
    return styles.achieved3
  }
  const dist = Math.min(i - current, 3)
  if (dist === 1) return styles.pending1
  if (dist === 2) return styles.pending2
  return styles.pending3
}

/** RGA-002 compliance bar + score + tier. Never show the bar alone. */
export function MaturityBlock({ score, mini = false }: Props) {
  const lvl = maturityLevel(score)
  const current = lvl ? LEVEL_CODES.indexOf(lvl.code as (typeof LEVEL_CODES)[number]) : -1
  const shown = lvl ? Math.round(Number(score)) : null

  return (
    <div className={`${styles.block} ${mini ? styles.mini : ''}`}>
      <div
        className={`${styles.cbar} ${mini ? styles.cbarMini : ''} ${current < 0 ? styles.cbarEmpty : ''}`}
        role="img"
        aria-label={
          lvl
            ? `Governance maturity ${lvl.code}, ${lvl.label}`
            : 'Governance maturity not yet assessed'
        }
      >
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className={`${styles.row} ${rowMod(i, current)}`} />
        ))}
      </div>
      <div className={styles.text}>
        {shown != null ? (
          <div className={styles.score}>
            {shown}
            <span className={styles.of}>/ 100</span>
          </div>
        ) : null}
        <div className={styles.tier}>{maturityLabel(score)}</div>
      </div>
    </div>
  )
}
