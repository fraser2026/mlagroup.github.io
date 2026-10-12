import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  DateField,
  Drawer,
  EmptyState,
  FilterBar,
  Ledger,
  LedgerRow,
  Notice,
  PageFrame,
  PageHeader,
  ProgressMeter,
  Section,
  SelectMenu,
  StatusLabel,
} from '../ui'
import type { StatusTone } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { personPickerLabel } from '../lib/accountLabel'
import { labelCtrlStatus } from '../lib/registry'
import { pct } from '../lib/workspace'
import { sb } from '../lib/supabase'
import styles from './FrameworkDetailPage.module.css'

type FwControl = {
  id: string
  title: string
  description: string
  mapped_control_id: string | null
  display_order: number
}

type OrgControl = {
  id: string
  reference: string | null
  title: string
  description: string | null
  purpose: string | null
  control_type: string
  pillar: string | null
  evidence_types: string[] | null
}

type TaskRow = {
  control_id: string
  task_number: number
  title: string
  description: string | null
  task_type: string
  options: { options?: string[]; fields?: string[] } | null
}

type Assignment = {
  id: string
  control_id: string
  system_id: string | null
  status: string
  assigned_to: string | null
  due_date: string | null
  priority: string | null
  ai_systems?: { name: string } | { name: string }[] | null
}

type Option = { value: string; label: string }

type TaskDraft = { key: string; title: string; description: string; task_type: string; items: string }

type Draft = {
  fcId: string | null
  title: string
  reference: string
  description: string
  purpose: string
  control_type: string
  pillar: string
  evidence: string[]
  tasks: TaskDraft[]
  systemIds: string[]
  assignedTo: string
  dueDate: string
  priority: string
}

const TYPE_OPTIONS: Option[] = [
  { value: 'organisation', label: 'Organisation' },
  { value: 'system', label: 'System' },
  { value: 'assurance', label: 'Assurance' },
]

const PILLAR_OPTIONS: Option[] = [
  { value: 'visibility', label: 'Visibility' },
  { value: 'accountability', label: 'Accountability' },
  { value: 'control', label: 'Control' },
  { value: 'assurance', label: 'Assurance' },
]

const RESPONSE_OPTIONS: Option[] = [
  { value: 'checkbox', label: 'Confirmation' },
  { value: 'fields', label: 'Structured fields' },
  { value: 'select', label: 'Single choice' },
  { value: 'text', label: 'Written response' },
]

const PRIORITY_OPTIONS: Option[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const EDIT_ROLES = new Set(['owner', 'admin', 'editor'])

let keySeq = 0
const nextKey = () => `t${++keySeq}`

function blankTask(): TaskDraft {
  return { key: nextKey(), title: '', description: '', task_type: 'checkbox', items: '' }
}

function blankDraft(): Draft {
  return {
    fcId: null,
    title: '',
    reference: '',
    description: '',
    purpose: '',
    control_type: 'organisation',
    pillar: 'control',
    evidence: [''],
    tasks: [blankTask()],
    systemIds: [],
    assignedTo: '',
    dueDate: '',
    priority: 'medium',
  }
}

function lines(s: string) {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function labelOf(options: Option[], value?: string | null) {
  return options.find((o) => o.value === value)?.label || ''
}

function assetName(a: Assignment) {
  const s = Array.isArray(a.ai_systems) ? a.ai_systems[0] : a.ai_systems
  return s?.name || 'AI asset'
}

const taskCount = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`

const isDone = (s: string) => s === 'implemented' || s === 'verified'

function rollup(list: Assignment[]): { tone: StatusTone; label: string; done: boolean } {
  if (!list.length) return { tone: 'warn', label: 'Setup needed', done: false }
  const done = list.filter((a) => isDone(a.status)).length
  if (done === list.length) {
    const verified = list.every((a) => a.status === 'verified')
    return { tone: 'ok', label: verified ? 'Verified' : 'Implemented', done: true }
  }
  if (list.length > 1) {
    return { tone: done ? 'warn' : 'neutral', label: `${done} of ${list.length} assets`, done: false }
  }
  const s = list[0].status
  return { tone: s === 'in_progress' ? 'warn' : 'neutral', label: labelCtrlStatus(s), done: false }
}

export function FrameworkDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { session, org, role } = useAuth()
  const orgId = org?.id || null
  const canEdit = EDIT_ROLES.has(String(role || '').toLowerCase())
  const canDeleteFramework = role === 'owner' || role === 'admin'

  const [name, setName] = useState('Framework')
  const [description, setDescription] = useState('')
  const [rows, setRows] = useState<FwControl[]>([])
  const [controls, setControls] = useState<Map<string, OrgControl>>(new Map())
  const [tasksByControl, setTasksByControl] = useState<Map<string, TaskRow[]>>(new Map())
  const [assignments, setAssignments] = useState<Map<string, Assignment[]>>(new Map())
  const [assets, setAssets] = useState<Option[]>([])
  const [members, setMembers] = useState<Option[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'control' | 'framework' | null>(null)
  const [removing, setRemoving] = useState(false)

  usePageChrome({
    title: name,
    breadcrumbs: [{ label: 'Frameworks', to: '/frameworks' }, { label: name }],
  })

  const refresh = useCallback(async () => {
    if (!id || !orgId) return
    const { data: fw } = await sb.from('org_frameworks').select('name,description').eq('id', id).maybeSingle()
    if (!fw) {
      setNotFound(true)
      return
    }
    setName(fw.name)
    setDescription(fw.description || '')

    const [{ data: fcs }, { data: sys }, { data: mem }] = await Promise.all([
      sb
        .from('org_framework_controls')
        .select('id,title,description,mapped_control_id,display_order')
        .eq('framework_id', id)
        .order('display_order'),
      sb.from('ai_systems').select('id,name').eq('org_id', orgId).is('deleted_at', null).order('name'),
      sb.from('org_members').select('user_id,role').eq('org_id', orgId),
    ])
    const list = (fcs as FwControl[]) || []
    setRows(list)
    setAssets((sys || []).map((s) => ({ value: s.id as string, label: s.name as string })))

    const editorIds = (mem || []).filter((m) => EDIT_ROLES.has(String(m.role))).map((m) => m.user_id as string)
    if (editorIds.length) {
      const { data: profiles } = await sb
        .from('profiles')
        .select('id,first_name,last_name,full_name,email')
        .in('id', editorIds)
      setMembers(
        (profiles || [])
          .map((p) => ({ value: p.id as string, label: personPickerLabel(p) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      )
    } else {
      setMembers([])
    }

    const mapped = list.map((r) => r.mapped_control_id).filter(Boolean) as string[]
    if (!mapped.length) {
      setControls(new Map())
      setTasksByControl(new Map())
      setAssignments(new Map())
      return
    }
    const [{ data: gc }, { data: ts }, { data: ca }] = await Promise.all([
      sb
        .from('governance_controls')
        .select('id,reference,title,description,purpose,control_type,pillar,evidence_types')
        .in('id', mapped),
      sb
        .from('control_tasks')
        .select('control_id,task_number,title,description,task_type,options')
        .in('control_id', mapped)
        .order('task_number'),
      sb
        .from('control_assignments')
        .select('id,control_id,system_id,status,assigned_to,due_date,priority,ai_systems(name)')
        .in('control_id', mapped),
    ])
    setControls(new Map(((gc as OrgControl[]) || []).map((c) => [c.id, c])))
    const tMap = new Map<string, TaskRow[]>()
    for (const t of (ts as TaskRow[]) || []) tMap.set(t.control_id, [...(tMap.get(t.control_id) || []), t])
    setTasksByControl(tMap)
    const aMap = new Map<string, Assignment[]>()
    for (const a of (ca as Assignment[]) || []) aMap.set(a.control_id, [...(aMap.get(a.control_id) || []), a])
    setAssignments(aMap)
  }, [id, orgId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!session?.user || !orgId) return
      setLoading(true)
      await refresh()
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [session, orgId, refresh])

  const view = useMemo(
    () =>
      rows.map((r) => {
        const ctrl = r.mapped_control_id ? controls.get(r.mapped_control_id) || null : null
        const list = ctrl ? assignments.get(ctrl.id) || [] : []
        return { row: r, ctrl, list, status: rollup(ctrl ? list : []) }
      }),
    [rows, controls, assignments],
  )

  const filtered = view.filter((v) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return `${v.row.title} ${v.row.description} ${v.ctrl?.reference || ''}`.toLowerCase().includes(q)
  })
  const done = view.filter((v) => v.status.done).length
  const selected = view.find((v) => v.row.id === selectedId) || null

  function openNew() {
    setFormError('')
    setDraft(blankDraft())
  }

  function openEdit(fcId: string) {
    const v = view.find((x) => x.row.id === fcId)
    if (!v) return
    setFormError('')
    const base = blankDraft()
    if (!v.ctrl) {
      setDraft({ ...base, fcId, title: v.row.title, description: v.row.description || '' })
    } else {
      const c = v.ctrl
      const first = v.list[0]
      const ts = tasksByControl.get(c.id) || []
      setDraft({
        fcId,
        title: c.title,
        reference: c.reference || '',
        description: c.description || '',
        purpose: c.purpose || '',
        control_type: c.control_type,
        pillar: c.pillar || 'control',
        evidence: c.evidence_types?.length ? [...c.evidence_types] : [''],
        tasks: ts.length
          ? ts.map((t) => ({
              key: nextKey(),
              title: t.title,
              description: t.description || '',
              task_type: t.task_type,
              items: (t.task_type === 'fields' ? t.options?.fields : t.options?.options)?.join('\n') || '',
            }))
          : [blankTask()],
        systemIds: v.list.map((a) => a.system_id).filter(Boolean) as string[],
        assignedTo: first?.assigned_to || '',
        dueDate: first?.due_date || '',
        priority: first?.priority || 'medium',
      })
    }
    setSelectedId(null)
  }

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d))
  const patchTask = (key: string, p: Partial<TaskDraft>) =>
    setDraft((d) => (d ? { ...d, tasks: d.tasks.map((t) => (t.key === key ? { ...t, ...p } : t)) } : d))

  function moveTask(index: number, dir: -1 | 1) {
    setDraft((d) => {
      if (!d) return d
      const next = [...d.tasks]
      const j = index + dir
      if (j < 0 || j >= next.length) return d
      ;[next[index], next[j]] = [next[j], next[index]]
      return { ...d, tasks: next }
    })
  }

  async function save() {
    if (!draft || !id) return
    const title = draft.title.trim()
    if (title.length < 2) {
      setFormError('Add a control title.')
      return
    }
    const tasks = draft.tasks.filter((t) => t.title.trim())
    for (const t of tasks) {
      if ((t.task_type === 'fields' || t.task_type === 'select') && !lines(t.items).length) {
        setFormError(`Add ${t.task_type === 'fields' ? 'fields' : 'choices'} for “${t.title.trim()}”.`)
        return
      }
    }
    if (draft.control_type === 'system' && !draft.systemIds.length) {
      setFormError('Select at least one AI asset.')
      return
    }
    setSaving(true)
    setFormError('')
    const { error } = await sb.rpc('save_org_framework_control', {
      p: {
        framework_id: id,
        framework_control_id: draft.fcId,
        title,
        reference: draft.reference.trim(),
        description: draft.description.trim(),
        purpose: draft.purpose.trim(),
        control_type: draft.control_type,
        pillar: draft.pillar,
        evidence_types: draft.evidence.map((e) => e.trim()).filter(Boolean),
        tasks: tasks.map((t) => ({
          title: t.title.trim(),
          description: t.description.trim(),
          task_type: t.task_type,
          options:
            t.task_type === 'fields'
              ? { fields: lines(t.items) }
              : t.task_type === 'select'
                ? { options: lines(t.items) }
                : null,
        })),
        system_ids: draft.control_type === 'system' ? draft.systemIds : [],
        assigned_to: draft.assignedTo,
        due_date: draft.dueDate,
        priority: draft.priority,
      },
    })
    setSaving(false)
    if (error) {
      setFormError(error.message || 'Could not save this control.')
      return
    }
    setDraft(null)
    await refresh()
  }

  async function removeControl() {
    if (!selected) return
    setRemoving(true)
    const { error } = await sb.rpc('delete_org_framework_control', { p_id: selected.row.id })
    setRemoving(false)
    setConfirm(null)
    if (!error) {
      setSelectedId(null)
      await refresh()
    }
  }

  async function removeFramework() {
    if (!id) return
    setRemoving(true)
    const { error } = await sb.rpc('delete_org_framework', { p_id: id })
    setRemoving(false)
    setConfirm(null)
    if (!error) navigate('/frameworks')
  }

  function openControl(assignmentId: string) {
    navigate(`/controls/${assignmentId}`)
  }

  if (loading) {
    return (
      <PageFrame>
        <PageHeader title={name} />
        <BrandLoader fill label="Loading framework" />
      </PageFrame>
    )
  }

  if (notFound) {
    return (
      <PageFrame>
        <PageHeader title="Framework not found" />
        <EmptyState
          title="This framework is no longer available"
          body="It may have been removed by an administrator."
          action={<Button onClick={() => navigate('/frameworks')}>Back to frameworks</Button>}
        />
      </PageFrame>
    )
  }

  const draftEditsExisting = Boolean(draft?.fcId && view.find((v) => v.row.id === draft.fcId)?.ctrl)
  const removedAssets =
    draft && draftEditsExisting && draft.control_type === 'system'
      ? (view.find((v) => v.row.id === draft.fcId)?.list || []).filter(
          (a) => a.system_id && !draft.systemIds.includes(a.system_id),
        ).length
      : 0

  return (
    <PageFrame
      railItems={[
        { id: 'overview', label: 'Overview' },
        { id: 'controls', label: 'Controls' },
      ]}
    >
      <PageHeader
        title={name}
        description={description || undefined}
        actions={
          <>
            {canDeleteFramework ? (
              <Button variant="ghost" onClick={() => setConfirm('framework')}>
                Delete
              </Button>
            ) : null}
            {canEdit ? <Button onClick={openNew}>Add control</Button> : null}
          </>
        }
      />

      <Section id="overview" title="Overview">
        <ProgressMeter value={pct(done, rows.length)} label={`${done} of ${rows.length} implemented`} />
      </Section>

      <Section id="controls" title="Controls">
        {rows.length ? (
          <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search controls" />
        ) : null}
        {rows.length === 0 ? (
          <EmptyState
            title="No controls yet"
            body="Define each requirement with its tasks, evidence and owner."
            action={canEdit ? <Button onClick={openNew}>Add control</Button> : undefined}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No matching controls" body="Try a different search." />
        ) : (
          <Ledger>
            {filtered.map((v) => {
              const meta = [
                v.ctrl?.reference,
                v.ctrl ? labelOf(TYPE_OPTIONS, v.ctrl.control_type) : null,
                v.ctrl ? taskCount((tasksByControl.get(v.ctrl.id) || []).length) : null,
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <LedgerRow
                  key={v.row.id}
                  title={v.row.title}
                  description={meta || v.row.description || undefined}
                  meta={<StatusLabel tone={v.status.tone}>{v.status.label}</StatusLabel>}
                  onClick={() => setSelectedId(v.row.id)}
                />
              )
            })}
          </Ledger>
        )}
      </Section>

      <Drawer
        open={!!selected}
        title={selected?.row.title || 'Control'}
        headerMeta={
          selected ? <StatusLabel tone={selected.status.tone}>{selected.status.label}</StatusLabel> : undefined
        }
        onClose={() => setSelectedId(null)}
        footer={
          selected ? (
            <div className={styles.footer}>
              {canEdit ? (
                <Button variant="ghost" size="sm" onClick={() => setConfirm('control')}>
                  Remove
                </Button>
              ) : null}
              <span className={styles.spacer} />
              {canEdit ? (
                <Button variant="ghost" size="sm" onClick={() => openEdit(selected.row.id)}>
                  {selected.ctrl ? 'Edit' : 'Complete setup'}
                </Button>
              ) : null}
              {selected.list.length === 1 ? (
                <Button size="sm" onClick={() => openControl(selected.list[0].id)}>
                  Open control
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      >
        {selected ? (
          <div className={styles.detail}>
            {!selected.ctrl ? (
              <Notice tone="warn" title="Setup needed">
                Add tasks, evidence and an owner so this control can be worked in Controls.
              </Notice>
            ) : null}
            <dl className={styles.facts}>
              {selected.ctrl?.reference ? (
                <div>
                  <dt>Reference</dt>
                  <dd>{selected.ctrl.reference}</dd>
                </div>
              ) : null}
              {selected.ctrl ? (
                <>
                  <div>
                    <dt>Type</dt>
                    <dd>{labelOf(TYPE_OPTIONS, selected.ctrl.control_type)}</dd>
                  </div>
                  <div>
                    <dt>Pillar</dt>
                    <dd>{labelOf(PILLAR_OPTIONS, selected.ctrl.pillar)}</dd>
                  </div>
                </>
              ) : null}
            </dl>
            {(selected.ctrl?.description || selected.row.description) ? (
              <div className={styles.block}>
                <h3>Requirement</h3>
                <p>{selected.ctrl?.description || selected.row.description}</p>
              </div>
            ) : null}
            {selected.ctrl?.purpose ? (
              <div className={styles.block}>
                <h3>Why it matters</h3>
                <p>{selected.ctrl.purpose}</p>
              </div>
            ) : null}
            {selected.ctrl ? (
              <div className={styles.block}>
                <h3>Tasks</h3>
                {(tasksByControl.get(selected.ctrl.id) || []).length ? (
                  <ol className={styles.list}>
                    {(tasksByControl.get(selected.ctrl.id) || []).map((t) => (
                      <li key={t.task_number}>
                        <span>{t.title}</span>
                        <span className={styles.listMeta}>{labelOf(RESPONSE_OPTIONS, t.task_type)}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.quiet}>No tasks defined.</p>
                )}
              </div>
            ) : null}
            {selected.ctrl?.evidence_types?.length ? (
              <div className={styles.block}>
                <h3>Expected evidence</h3>
                <ul className={styles.list}>
                  {selected.ctrl.evidence_types.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {selected.list.length > 1 || (selected.list.length === 1 && selected.list[0].system_id) ? (
              <div className={styles.block}>
                <h3>Assets in scope</h3>
                <Ledger>
                  {selected.list.map((a) => (
                    <LedgerRow
                      key={a.id}
                      title={assetName(a)}
                      meta={
                        <StatusLabel tone={isDone(a.status) ? 'ok' : a.status === 'in_progress' ? 'warn' : 'neutral'}>
                          {labelCtrlStatus(a.status)}
                        </StatusLabel>
                      }
                      onClick={() => openControl(a.id)}
                    />
                  ))}
                </Ledger>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={!!draft}
        title={draft?.fcId ? (draftEditsExisting ? 'Edit control' : 'Complete control setup') : 'Add control'}
        onClose={() => setDraft(null)}
        footer={
          <div className={styles.footer}>
            <span className={styles.spacer} />
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void save()} pending={saving}>
              {draft?.fcId ? 'Save control' : 'Add control'}
            </Button>
          </div>
        }
      >
        {draft ? (
          <div className={styles.form}>
            {formError ? (
              <Notice tone="risk" title="Check this control">
                {formError}
              </Notice>
            ) : null}

            <fieldset className={styles.group}>
              <legend>Control</legend>
              <label className={styles.field}>
                <span>Title</span>
                <input
                  value={draft.title}
                  maxLength={200}
                  onChange={(e) => patch({ title: e.target.value })}
                  placeholder="e.g. Model change approval"
                />
              </label>
              <label className={styles.field}>
                <span>Reference</span>
                <input
                  value={draft.reference}
                  maxLength={60}
                  onChange={(e) => patch({ reference: e.target.value })}
                  placeholder="e.g. ISO 42001 A.6.2"
                />
              </label>
              <div className={styles.pair}>
                <div className={styles.field}>
                  <span>Type</span>
                  <SelectMenu
                    aria-label="Control type"
                    value={draft.control_type}
                    options={TYPE_OPTIONS}
                    onChange={(v) => patch({ control_type: v })}
                  />
                </div>
                <div className={styles.field}>
                  <span>Pillar</span>
                  <SelectMenu
                    aria-label="Pillar"
                    value={draft.pillar}
                    options={PILLAR_OPTIONS}
                    onChange={(v) => patch({ pillar: v })}
                  />
                </div>
              </div>
              <label className={styles.field}>
                <span>Requirement</span>
                <textarea
                  rows={3}
                  value={draft.description}
                  maxLength={4000}
                  onChange={(e) => patch({ description: e.target.value })}
                  placeholder="What the organisation must have in place"
                />
              </label>
              <label className={styles.field}>
                <span>Why it matters</span>
                <textarea
                  rows={2}
                  value={draft.purpose}
                  onChange={(e) => patch({ purpose: e.target.value })}
                  placeholder="The risk this control addresses"
                />
              </label>
            </fieldset>

            <fieldset className={styles.group}>
              <legend>Tasks</legend>
              {draft.tasks.map((t, i) => (
                <div key={t.key} className={styles.task}>
                  <div className={styles.taskHead}>
                    <span className={styles.marker}>{i + 1}</span>
                    <div className={styles.taskTools}>
                      <button type="button" onClick={() => moveTask(i, -1)} disabled={i === 0} aria-label="Move up">
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveTask(i, 1)}
                        disabled={i === draft.tasks.length - 1}
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => patch({ tasks: draft.tasks.filter((x) => x.key !== t.key) })}
                        aria-label="Remove task"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <label className={styles.field}>
                    <span>Task</span>
                    <input
                      value={t.title}
                      onChange={(e) => patchTask(t.key, { title: e.target.value })}
                      placeholder="e.g. Record approver"
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Guidance</span>
                    <input
                      value={t.description}
                      onChange={(e) => patchTask(t.key, { description: e.target.value })}
                      placeholder="Optional"
                    />
                  </label>
                  <div className={styles.field}>
                    <span>Response</span>
                    <SelectMenu
                      aria-label={`Task ${i + 1} response`}
                      value={t.task_type}
                      options={RESPONSE_OPTIONS}
                      onChange={(v) => patchTask(t.key, { task_type: v })}
                    />
                  </div>
                  {t.task_type === 'fields' || t.task_type === 'select' ? (
                    <label className={styles.field}>
                      <span>{t.task_type === 'fields' ? 'Fields' : 'Choices'}</span>
                      <textarea
                        rows={3}
                        value={t.items}
                        onChange={(e) => patchTask(t.key, { items: e.target.value })}
                        placeholder="One per line"
                      />
                    </label>
                  ) : null}
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => patch({ tasks: [...draft.tasks, blankTask()] })}
              >
                Add task
              </Button>
            </fieldset>

            <fieldset className={styles.group}>
              <legend>Expected evidence</legend>
              {draft.evidence.map((e, i) => (
                <div key={i} className={styles.inline}>
                  <input
                    value={e}
                    onChange={(ev) =>
                      patch({ evidence: draft.evidence.map((x, j) => (j === i ? ev.target.value : x)) })
                    }
                    placeholder="e.g. Signed approval record"
                  />
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => patch({ evidence: draft.evidence.filter((_, j) => j !== i) })}
                    aria-label="Remove evidence"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={() => patch({ evidence: [...draft.evidence, ''] })}>
                Add evidence
              </Button>
            </fieldset>

            <fieldset className={styles.group}>
              <legend>Scope</legend>
              {draft.control_type === 'system' ? (
                assets.length ? (
                  <>
                    <div className={styles.checks}>
                      {assets.map((a) => (
                        <label key={a.value} className={styles.check}>
                          <input
                            type="checkbox"
                            checked={draft.systemIds.includes(a.value)}
                            onChange={(e) =>
                              patch({
                                systemIds: e.target.checked
                                  ? [...draft.systemIds, a.value]
                                  : draft.systemIds.filter((s) => s !== a.value),
                              })
                            }
                          />
                          {a.label}
                        </label>
                      ))}
                    </div>
                    {removedAssets ? (
                      <Notice tone="warn" title="Progress will be removed">
                        Deselected assets lose their task responses and evidence links for this control.
                      </Notice>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.quiet}>Register an AI asset to scope a system control.</p>
                )
              ) : (
                <p className={styles.quiet}>Applies across the organisation.</p>
              )}
            </fieldset>

            <fieldset className={styles.group}>
              <legend>Assignment</legend>
              <div className={styles.field}>
                <span>Owner</span>
                <SelectMenu
                  aria-label="Owner"
                  value={draft.assignedTo}
                  options={[{ value: '', label: 'Unassigned' }, ...members]}
                  onChange={(v) => patch({ assignedTo: v })}
                />
              </div>
              <div className={styles.pair}>
                <div className={styles.field}>
                  <span>Due date</span>
                  <DateField value={draft.dueDate} onChange={(v) => patch({ dueDate: v })} />
                </div>
                <div className={styles.field}>
                  <span>Priority</span>
                  <SelectMenu
                    aria-label="Priority"
                    value={draft.priority}
                    options={PRIORITY_OPTIONS}
                    onChange={(v) => patch({ priority: v })}
                  />
                </div>
              </div>
            </fieldset>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={!!confirm}
        placement="center"
        title={confirm === 'framework' ? 'Delete framework' : 'Remove control'}
        onClose={() => setConfirm(null)}
        footer={
          <div className={styles.footer}>
            <span className={styles.spacer} />
            <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              pending={removing}
              onClick={() => void (confirm === 'framework' ? removeFramework() : removeControl())}
            >
              {confirm === 'framework' ? 'Delete framework' : 'Remove control'}
            </Button>
          </div>
        }
      >
        <p className={styles.copy}>
          {confirm === 'framework'
            ? `${name} and its ${rows.length} controls will be removed, including task responses. This cannot be undone.`
            : 'This control, its task responses and assignments will be removed. This cannot be undone.'}
        </p>
      </Drawer>
    </PageFrame>
  )
}
