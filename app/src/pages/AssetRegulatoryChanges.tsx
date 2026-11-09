import { useEffect, useState } from 'react'
import { Ledger, LedgerRow, RaNum, StatusLabel } from '../ui'
import {
  CHANGE_LABELS,
  describeImpact,
  fmtRegDate,
  loadAssetRegChanges,
  type RegChange,
} from '../lib/regChanges'
import styles from './AssetRegulatoryChanges.module.css'

function rowDescription(c: RegChange) {
  const lines = [c.title + '.']
  if (c.includes.length) lines.push(`Including ${c.includes.join(', ')}.`)
  if (c.replaces) lines.push(`Replaces ${c.replaces}.`)
  if (c.replaced_by) lines.push(`Replaced by ${c.replaced_by}.`)
  const impact = describeImpact(c)
  if (impact) lines.push(impact)
  return lines.join(' ')
}

export function AssetRegulatoryChanges({ systemId }: { systemId: string }) {
  const [rows, setRows] = useState<RegChange[]>([])

  useEffect(() => {
    let cancelled = false
    void loadAssetRegChanges(systemId).then((r) => {
      if (!cancelled) setRows(r)
    })
    return () => {
      cancelled = true
    }
  }, [systemId])

  if (!rows.length) return null

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h3 className={styles.title}>Changes since your last assessment</h3>
        <p className={styles.desc}>
          Your last assessment was completed on {fmtRegDate(rows[0].assessed_on)}. The requirements below have
          changed since then. Review the affected answers and controls, then run a new assessment to update your
          record.
        </p>
      </header>
      <Ledger flush>
        {rows.map((c) => {
          const kind = CHANGE_LABELS[c.change]
          return (
            <LedgerRow
              key={`${c.requirement_key}-${c.change}`}
              title={c.citation}
              description={rowDescription(c)}
              meta={<StatusLabel tone={kind.tone}>{kind.label}</StatusLabel>}
              trailing={
                <>
                  <RaNum className={styles.date}>{fmtRegDate(c.changed_on)}</RaNum>
                  {c.official_url ? (
                    <a className={styles.link} href={c.official_url} target="_blank" rel="noreferrer">
                      Official text
                    </a>
                  ) : null}
                </>
              }
            />
          )
        })}
      </Ledger>
    </div>
  )
}
