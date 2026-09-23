import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@ra/ui'
import { ChevronDown, MoreHorizontal } from 'lucide-react'
import styles from '../pages/Catalogue.module.css'

type ToolbarProps = {
  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  selectMode: boolean
  selectedCount: number
  visibleCount: number
  allVisibleSelected: boolean
  someVisibleSelected: boolean
  onToggleBulk: () => void
  onToggleAllVisible: (checked: boolean) => void
  onExportSelected: () => void
  leading?: ReactNode
}

export function CatalogueToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search',
  selectMode,
  selectedCount,
  visibleCount,
  allVisibleSelected,
  someVisibleSelected,
  onToggleBulk,
  onToggleAllVisible,
  onExportSelected,
  leading,
}: ToolbarProps) {
  const [bulkOpen, setBulkOpen] = useState(false)
  const bulkRef = useRef<HTMLDivElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!selectMode) setBulkOpen(false)
  }, [selectMode])

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected
    }
  }, [someVisibleSelected, allVisibleSelected])

  useEffect(() => {
    if (!bulkOpen) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (!bulkRef.current?.contains(t)) setBulkOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [bulkOpen])

  function toggleBulk() {
    if (!selectMode) {
      onToggleBulk()
      setBulkOpen(true)
      return
    }
    if (bulkOpen) {
      onToggleBulk()
      setBulkOpen(false)
      return
    }
    setBulkOpen(true)
  }

  return (
    <div className={styles.toolbar}>
      <div className={styles.toolbarLeading}>
        {selectMode ? (
          <label className={styles.selectAll}>
            <input
              ref={selectAllRef}
              type="checkbox"
              className={styles.checkBox}
              checked={allVisibleSelected && visibleCount > 0}
              aria-label="Select all visible rows"
              onChange={(e) => onToggleAllVisible(e.target.checked)}
            />
            <span>
              {allVisibleSelected && visibleCount
                ? `All ${visibleCount} selected`
                : selectedCount
                  ? `${selectedCount} selected`
                  : 'Select all'}
            </span>
          </label>
        ) : (
          leading
        )}
      </div>
      <div className={styles.toolbarTools}>
        <input
          className={styles.search}
          type="search"
          value={search}
          placeholder={searchPlaceholder}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <div className={styles.bulk} ref={bulkRef}>
          <Button variant="ghost" size="sm" selected={selectMode} onClick={toggleBulk} aria-expanded={bulkOpen}>
            Bulk actions{selectedCount ? ` (${selectedCount})` : ''}
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
          </Button>
          {bulkOpen && selectMode ? (
            <div className={styles.bulkMenuShell}>
              <div className={styles.bulkMenu} role="menu">
                <div className={styles.bulkMeta}>
                  {selectedCount ? `${selectedCount} selected` : 'Select rows in the list'}
                </div>
                <button
                  type="button"
                  className={styles.bulkItem}
                  disabled={!selectedCount}
                  onClick={() => {
                    onExportSelected()
                    setBulkOpen(false)
                  }}
                >
                  Export CSV
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

type RowActionsProps = {
  label: string
  selectMode: boolean
  selected: boolean
  onToggleSelect: (checked: boolean) => void
  onEdit: () => void
  onExportRow: () => void
}

export function CatalogueRowActions({
  label,
  selectMode,
  selected,
  onToggleSelect,
  onEdit,
  onExportRow,
}: RowActionsProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (!rootRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className={styles.rowActions} ref={rootRef}>
      {selectMode ? (
        <input
          type="checkbox"
          className={styles.checkBox}
          checked={selected}
          aria-label={`Select ${label}`}
          onChange={(e) => onToggleSelect(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : null}
      <div className={styles.rowMore}>
        <button
          type="button"
          className={styles.moreBtn}
          aria-label={`Actions for ${label}`}
          aria-expanded={open}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        >
          <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden />
        </button>
        {open ? (
          <div className={styles.rowMenu} role="menu">
            <button
              type="button"
              className={styles.bulkItem}
              onClick={() => {
                setOpen(false)
                onEdit()
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className={styles.bulkItem}
              onClick={() => {
                setOpen(false)
                onExportRow()
              }}
            >
              Export CSV
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function useCatalogueSelection(ids: string[]) {
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const selectedIds = useMemo(() => ids.filter((id) => selected[id]), [ids, selected])
  const selectedCount = selectedIds.length
  const visibleCount = ids.length
  const allVisibleSelected = visibleCount > 0 && selectedIds.length === visibleCount
  const someVisibleSelected = selectedIds.length > 0 && !allVisibleSelected

  function toggleBulk() {
    if (selectMode) {
      setSelectMode(false)
      setSelected({})
    } else {
      setSelectMode(true)
    }
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => ({ ...prev, [id]: checked }))
  }

  function toggleAllVisible(checked: boolean) {
    if (!checked) {
      setSelected((prev) => {
        const next = { ...prev }
        for (const id of ids) delete next[id]
        return next
      })
      return
    }
    setSelected((prev) => {
      const next = { ...prev }
      for (const id of ids) next[id] = true
      return next
    })
  }

  function clearSelection() {
    setSelected({})
    setSelectMode(false)
  }

  return {
    selectMode,
    selected,
    selectedIds,
    selectedCount,
    visibleCount,
    allVisibleSelected,
    someVisibleSelected,
    toggleBulk,
    toggleOne,
    toggleAllVisible,
    clearSelection,
  }
}
