import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable, RaNum, Section } from '../ui'
import { fmtRegDate, labelRoles, loadOrgHorizon, type HorizonItem } from '../lib/regChanges'
import styles from './RegulatoryHorizon.module.css'

export function RegulatoryHorizon({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<HorizonItem[]>([])

  useEffect(() => {
    let cancelled = false
    void loadOrgHorizon(orgId).then((r) => {
      if (!cancelled) setRows(r)
    })
    return () => {
      cancelled = true
    }
  }, [orgId])

  const columns = useMemo<ColumnDef<HorizonItem>[]>(
    () => [
      {
        id: 'effective_from',
        header: 'Applies from',
        accessorKey: 'effective_from',
        size: 130,
        cell: ({ row }) => <RaNum className={styles.date}>{fmtRegDate(row.original.effective_from)}</RaNum>,
      },
      {
        id: 'requirement',
        header: 'Requirement',
        accessorKey: 'citation',
        meta: { flex: true },
        cell: ({ row }) => (
          <div className={styles.req}>
            <span className={styles.citation}>{row.original.citation}</span>
            <span className={styles.reqTitle}>{row.original.title}</span>
          </div>
        ),
      },
      {
        id: 'applies_to',
        header: 'Applies to',
        size: 170,
        enableSorting: false,
        cell: ({ row }) => <span className={styles.secondary}>{labelRoles(row.original.applies_to)}</span>,
      },
      {
        id: 'assets',
        header: 'Your assets',
        accessorKey: 'assets',
        size: 130,
        cell: ({ row }) => {
          const n = row.original.assets
          const label = `${n} ${n === 1 ? 'asset' : 'assets'}`
          return (
            <RaNum className={styles.assets}>
              {row.original.scope === 'all_systems' && n > 1 ? `All ${label}` : label}
            </RaNum>
          )
        },
      },
      {
        id: 'link',
        header: '',
        size: 110,
        enableSorting: false,
        meta: { fixed: true },
        cell: ({ row }) =>
          row.original.official_url ? (
            <a className={styles.link} href={row.original.official_url} target="_blank" rel="noreferrer">
              Official text
            </a>
          ) : null,
      },
    ],
    [],
  )

  if (!rows.length) return null

  return (
    <Section
      id="horizon"
      title="Coming into force"
      description="Requirements that apply from a future date and cover your assets, based on your assessments, obligations and controls. Prohibitions apply to every AI system."
    >
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(r) => r.requirement_key}
        initialSorting={[{ id: 'effective_from', desc: false }]}
      />
    </Section>
  )
}
