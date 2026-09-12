import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, ChevronLeft, ListFilter } from 'lucide-react'
import { clsx } from 'clsx'
import { Icon } from './Icon'
import styles from './DataTable.module.css'

export type ColumnFilterOption = {
  value: string
  label: string
  badge?: ReactNode
}

export type ColumnFilterConfig = {
  label: string
  value: string
  options: ColumnFilterOption[]
  onChange: (value: string) => void
}

export type ColumnSortLabels = {
  asc: string
  desc: string
}

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    flex?: boolean
    selectOnly?: boolean
    sortLabels?: ColumnSortLabels
    filter?: ColumnFilterConfig
  }
}

type Props<T> = {
  data: T[]
  columns: ColumnDef<T, any>[]
  onRowClick?: (row: T) => void
  empty?: ReactNode
  getRowId?: (row: T) => string
  /** Applied on first mount and after full remount (e.g. refresh). */
  initialSorting?: SortingState
}

type MenuView = 'root' | 'filter'

function placeMenu(trigger: HTMLElement, menuEl: HTMLElement | null): CSSProperties {
  const r = trigger.getBoundingClientRect()
  const width = 220
  const gap = 6
  const menuH = menuEl?.offsetHeight || 168
  const spaceBelow = window.innerHeight - r.bottom - 12
  const openUp = spaceBelow < menuH + 8 && r.top > spaceBelow
  const left = Math.min(Math.max(8, Math.round(r.left)), window.innerWidth - width - 8)
  return {
    position: 'fixed',
    left,
    width,
    ...(openUp
      ? { bottom: Math.round(window.innerHeight - r.top + gap), top: 'auto' }
      : { top: Math.round(r.bottom + gap), bottom: 'auto' }),
  }
}

function SortGlyph() {
  return (
    <svg className={styles.sortGlyph} width="8" height="12" viewBox="0 0 8 12" fill="none" aria-hidden>
      <path
        d="M1.2 4.1 4 1.4 6.8 4.1"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M1.2 7.9 4 10.6 6.8 7.9"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function DataTable<T>({ data, columns, onRowClick, empty, getRowId, initialSorting }: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? [])
  const [menuColId, setMenuColId] = useState<string | null>(null)
  const [menuView, setMenuView] = useState<MenuView>('root')
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
  })

  function closeMenu() {
    setMenuColId(null)
    setMenuView('root')
    setMenuStyle(null)
    triggerRef.current = null
  }

  function openMenu(trigger: HTMLElement, columnId: string) {
    if (menuColId === columnId) {
      closeMenu()
      return
    }
    triggerRef.current = trigger
    setMenuView('root')
    setMenuColId(columnId)
    setMenuStyle(placeMenu(trigger, null))
  }

  useLayoutEffect(() => {
    if (!menuColId) return
    const trigger = triggerRef.current
    if (!trigger?.isConnected) {
      closeMenu()
      return
    }
    function sync() {
      const t = triggerRef.current
      if (!t?.isConnected) {
        closeMenu()
        return
      }
      setMenuStyle(placeMenu(t, menuRef.current))
    }
    sync()
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [menuColId, menuView])

  useEffect(() => {
    if (!menuColId) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      closeMenu()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeMenu()
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuColId])

  const rows = table.getRowModel().rows
  const openHeader = menuColId ? table.getHeaderGroups()[0]?.headers.find((h) => h.column.id === menuColId) : null
  const openMeta = openHeader?.column.columnDef.meta
  const openSorted = openHeader?.column.getIsSorted()
  const sortLabels = openMeta?.sortLabels ?? { asc: 'Sort ascending', desc: 'Sort descending' }
  const filterCfg = openMeta?.filter

  if (!rows.length) {
    return <>{empty}</>
  }

  const menu =
    menuColId && menuStyle && openHeader
      ? createPortal(
          <div
            ref={menuRef}
            className={styles.colMenu}
            role="menu"
            aria-label={`${String(openHeader.column.columnDef.header)} column`}
            style={menuStyle}
          >
            {menuView === 'filter' && filterCfg ? (
              <>
                <button
                  type="button"
                  className={styles.colMenuItem}
                  role="menuitem"
                  onClick={() => setMenuView('root')}
                >
                  <Icon icon={ChevronLeft} size="sm" />
                  <span>{filterCfg.label}</span>
                </button>
                <div className={styles.colMenuRule} role="separator" />
                {filterCfg.options.map((o) => (
                  <button
                    key={o.value || 'all'}
                    type="button"
                    className={clsx(styles.colMenuItem, filterCfg.value === o.value && styles.colMenuItemOn)}
                    role="menuitemradio"
                    aria-checked={filterCfg.value === o.value}
                    onClick={() => {
                      filterCfg.onChange(o.value)
                      closeMenu()
                    }}
                  >
                    <span className={styles.colMenuLabel}>
                      {o.badge ? o.badge : o.label}
                    </span>
                  </button>
                ))}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={clsx(styles.colMenuItem, openSorted === 'asc' && styles.colMenuItemOn)}
                  role="menuitemradio"
                  aria-checked={openSorted === 'asc'}
                  onClick={() => {
                    setSorting([{ id: openHeader.column.id, desc: false }])
                    closeMenu()
                  }}
                >
                  <Icon icon={ArrowUp} size="sm" />
                  <span>{sortLabels.asc}</span>
                </button>
                <button
                  type="button"
                  className={clsx(styles.colMenuItem, openSorted === 'desc' && styles.colMenuItemOn)}
                  role="menuitemradio"
                  aria-checked={openSorted === 'desc'}
                  onClick={() => {
                    setSorting([{ id: openHeader.column.id, desc: true }])
                    closeMenu()
                  }}
                >
                  <Icon icon={ArrowDown} size="sm" />
                  <span>{sortLabels.desc}</span>
                </button>
                {filterCfg ? (
                  <>
                    <div className={styles.colMenuRule} role="separator" />
                    <button
                      type="button"
                      className={styles.colMenuItem}
                      role="menuitem"
                      onClick={() => setMenuView('filter')}
                    >
                      <Icon icon={ListFilter} size="sm" />
                      <span>{filterCfg.label}</span>
                    </button>
                  </>
                ) : null}
              </>
            )}
          </div>,
          document.body,
        )
      : null

  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const canSort = header.column.getCanSort()
                const open = menuColId === header.column.id
                return (
                  <th
                    key={header.id}
                    className={styles.th}
                    style={
                      header.column.columnDef.meta?.flex
                        ? { width: 'auto' }
                        : header.getSize() === 150
                          ? undefined
                          : { width: header.getSize() }
                    }
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        className={styles.sortBtn}
                        aria-haspopup="menu"
                        aria-expanded={open}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          openMenu(e.currentTarget, header.column.id)
                        }}
                      >
                        <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                        <SortGlyph />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={clsx(styles.tr, onRowClick && styles.clickable)}
              onClick={
                onRowClick
                  ? (e) => {
                      const t = e.target as HTMLElement | null
                      if (t?.closest('button, a, input, label, [role="menu"], [data-row-more]')) return
                      onRowClick(row.original)
                    }
                  : undefined
              }
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onRowClick(row.original)
                      }
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? 'button' : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className={styles.td}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {menu}
    </div>
  )
}
