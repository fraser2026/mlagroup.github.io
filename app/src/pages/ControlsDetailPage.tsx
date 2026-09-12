import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  DateField,
  EmptyState,
  Notice,
  PageFrame,
  PageHeader,
  ProgressMeter,
  Section,
  SelectMenu,
  StatusLabel,
  ToastStack,
} from '../ui'
import type { ToastItem } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { actorName, writeAuditLog } from '../lib/audit'
import { controlCode, labelCtrlStatus } from '../lib/registry'
import { pct } from '../lib/workspace'
import { sb } from '../lib/supabase'
import styles from './ControlsDetailPage.module.css'

type Control = {
  id: string
  title?: string | null
  control_number?: string | number | null
  control_type?: string | null
  pillar?: string | null
  description?: string | null
  purpose?: string | null
  evidence_types?: string[] | null
  is_org_level?: boolean | null
}

type Assignment = {
  id: string
  status?: string | null
  notes?: string | null
  due_date?: string | null
  priority?: string | null
  assigned_to?: string | null
  assigned_by?: string | null
  assigned_at?: string | null
  control_id?: string | null
  system_id?: string | null
  task_responses?: Record<string, string> | null
  governance_controls?: Control | null
  ai_systems?: { name?: string | null } | null
}

type ControlTask = {
  id: string
  control_id: string
  task_number: number
  title: string
  description?: string | null
  task_type: string
  display_order?: number | null
  options?: { options?: string[]; fields?: string[] } | null
}

type Evidence = {
  id: string
  file_name: string
  file_path: string
  uploaded_at?: string | null
}

type SupportReq = {
  id: string
  client_message?: string | null
  status?: string | null
  requested_at?: string | null
  mla_response?: string | null
}

type Member = { id: string; name: string }

const CONTROL_DETAIL_RAIL = [
  { id: 'overview', label: 'Overview' },
  { id: 'assignment', label: 'Assignment' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'support', label: 'Expert help' },
]

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

function toneFor(status?: string | null) {
  if (status === 'implemented' || status === 'verified') return 'ok' as const
  if (status === 'overdue') return 'risk' as const
  if (status === 'in_progress') return 'warn' as const
  return 'neutral' as const
}

function isDone(status?: string | null) {
  return status === 'implemented' || status === 'verified'
}

function titleCase(s?: string | null) {
  if (!s) return ''
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function fieldHint(label: string) {
  const l = label.toLowerCase()
  if (l.includes('email')) return 'name@company.com'
  if (l.includes('date')) return 'YYYY-MM-DD'
  if (l.includes('url') || l.includes('link')) return 'https://'
  return ''
}

function taskDone(t: ControlTask, resp: Record<string, string>) {
  const key = `task_${t.task_number}`
  const val = resp[key] || ''
  if (t.task_type === 'checkbox') return val === 'done'
  if (t.task_type === 'fields') {
    const fields = t.options?.fields || []
    return fields.length > 0 && fields.every((f) => (resp[`${key}_${f}`] || '').trim() !== '')
  }
  return val.trim() !== ''
}

type NavState = {
  from?: 'controls' | 'registry'
  assetId?: string
  assetName?: string
}

export function ControlsDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const nav = (location.state || {}) as NavState
  const fromRegistry = nav.from === 'registry'
  const { session, org, profile } = useAuth()
  const orgId = org?.id || null
  const userId = session?.user?.id

  const [assign, setAssign] = useState<Assignment | null>(null)
  const [tasks, setTasks] = useState<ControlTask[]>([])
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [support, setSupport] = useState<SupportReq[]>([])
  const [responses, setResponses] = useState<Record<string, string>>({})
  const [assignedTo, setAssignedTo] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState('medium')
  const [assignInfo, setAssignInfo] = useState('')
  const [assignStatus, setAssignStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [supportMsg, setSupportMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const skipAssignSave = useRef(true)

  const ctrl = assign?.governance_controls
  const rawTitle = ctrl?.title || 'Control'
  const code = controlCode(ctrl?.control_number)
  const title = code ? `${code} ${rawTitle}` : rawTitle
  const systemId = (fromRegistry && nav.assetId) || assign?.system_id || null
  const assetLabel =
    (fromRegistry && nav.assetName) ||
    assign?.ai_systems?.name ||
    (ctrl?.is_org_level ? 'Organisation-level' : 'Unlinked asset')

  function pushToast(text: string) {
    if (!text.trim()) return
    const tid =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts((prev) => [...prev, { id: tid, text }])
  }

  function dismissToast(toastId: string) {
    setToasts((prev) => prev.filter((t) => t.id !== toastId))
  }

  const crumbs =
    fromRegistry && systemId
      ? [
          { label: 'Registry', to: '/registry' },
          { label: assetLabel, to: `/registry/${systemId}?tab=controls` },
          { label: title },
        ]
      : [
          { label: 'Controls', to: '/controls' },
          { label: title },
        ]

  const backTo =
    fromRegistry && systemId ? `/registry/${systemId}?tab=controls` : '/controls'
  const backLabel = fromRegistry && systemId ? 'Back to asset controls' : 'Back to controls'

  usePageChrome({
    title,
    breadcrumbs: crumbs,
    openRail: true,
  })

  async function loadEvidence(assignmentId: string) {
    const { data } = await sb
      .from('evidence_uploads')
      .select('id,file_name,file_path,uploaded_at')
      .eq('control_assignment_id', assignmentId)
      .order('uploaded_at', { ascending: false })
    setEvidence((data as Evidence[]) || [])
  }

  async function loadSupport(assignmentId: string) {
    const { data } = await sb
      .from('support_requests')
      .select('id,client_message,status,requested_at,mla_response')
      .eq('control_assignment_id', assignmentId)
      .order('requested_at', { ascending: true })
    setSupport((data as SupportReq[]) || [])
  }

  async function refresh() {
    if (!id || !userId || !orgId) return
    setError('')
    const { data, error: loadErr } = await sb
      .from('control_assignments')
      .select(
        'id,status,notes,due_date,priority,assigned_to,assigned_by,assigned_at,control_id,system_id,task_responses,governance_controls(id,title,control_number,control_type,pillar,description,purpose,evidence_types,is_org_level),ai_systems(name)',
      )
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (loadErr || !data) {
      setAssign(null)
      setLoading(false)
      setError(loadErr?.message || 'Assignment not found.')
      return
    }

    const raw = data as unknown as {
      id: string
      status?: string | null
      notes?: string | null
      due_date?: string | null
      priority?: string | null
      assigned_to?: string | null
      assigned_by?: string | null
      assigned_at?: string | null
      control_id?: string | null
      system_id?: string | null
      task_responses?: Record<string, string> | null
      governance_controls?: Control | Control[] | null
      ai_systems?: { name?: string | null } | { name?: string | null }[] | null
    }
    const row: Assignment = {
      id: raw.id,
      status: raw.status,
      notes: raw.notes,
      due_date: raw.due_date,
      priority: raw.priority,
      assigned_to: raw.assigned_to,
      assigned_by: raw.assigned_by,
      assigned_at: raw.assigned_at,
      control_id: raw.control_id,
      system_id: raw.system_id,
      task_responses: raw.task_responses,
      governance_controls: asOne(raw.governance_controls),
      ai_systems: asOne(raw.ai_systems),
    }
    setAssign(row)
    skipAssignSave.current = true
    setAssignedTo(row.assigned_to || '')
    setDueDate(row.due_date || '')
    setPriority(row.priority || 'medium')
    setResponses((row.task_responses as Record<string, string>) || {})

    if (row.assigned_at && row.assigned_by) {
      const { data: p } = await sb
        .from('profiles')
        .select('full_name,email')
        .eq('id', row.assigned_by)
        .maybeSingle()
      const who = p?.full_name || p?.email || 'Unknown'
      setAssignInfo(`Assigned by ${who} on ${new Date(row.assigned_at).toLocaleDateString()}`)
    } else {
      setAssignInfo('')
    }

    const controlId = row.control_id
    const [{ data: taskRows }, { data: memRows }] = await Promise.all([
      controlId
        ? sb.from('control_tasks').select('*').eq('control_id', controlId).order('display_order')
        : Promise.resolve({ data: [] }),
      sb.from('org_members').select('user_id').eq('org_id', orgId),
    ])

    setTasks(((taskRows as ControlTask[]) || []).sort((a, b) => a.task_number - b.task_number))

    const memberIds = (memRows || []).map((m) => m.user_id as string)
    if (memberIds.length) {
      const { data: profiles } = await sb.from('profiles').select('id,full_name,email').in('id', memberIds)
      setMembers(
        (profiles || []).map((p) => ({
          id: p.id as string,
          name: (p.full_name as string) || (p.email as string) || 'Unknown',
        })),
      )
    } else {
      setMembers([])
    }

    await Promise.all([loadEvidence(row.id), loadSupport(row.id)])
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    async function boot() {
      setLoading(true)
      if (!orgId || !userId) {
        if (!cancelled) setLoading(false)
        return
      }
      await refresh()
    }
    void boot()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId, userId])

  const doneCount = useMemo(() => tasks.filter((t) => taskDone(t, responses)).length, [tasks, responses])
  const taskPct = pct(doneCount, tasks.length)
  const complete = isDone(assign?.status)

  useEffect(() => {
    if (!assign || !orgId || !userId || !assign.control_id) return
    if (skipAssignSave.current) {
      skipAssignSave.current = false
      return
    }
    const timer = window.setTimeout(() => {
      void saveAssignmentFields()
    }, 400)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedTo, dueDate, priority])

  async function saveAssignmentFields() {
    if (!assign || !orgId || !userId || !assign.control_id) return
    const assignTo = assignedTo || null
    const update: Record<string, unknown> = {
      assigned_to: assignTo,
      due_date: dueDate || null,
      priority: priority || 'medium',
    }
    if (assignTo && !assign.assigned_to) {
      update.assigned_by = userId
      update.assigned_at = new Date().toISOString()
    } else if (!assignTo) {
      update.assigned_by = null
      update.assigned_at = null
    }
    setAssignStatus('Saving…')
    const { error: err } = await sb.from('control_assignments').update(update).eq('id', assign.id)
    if (err) {
      setAssignStatus(`Error: ${err.message}`)
      return
    }
    setAssign((prev) =>
      prev
        ? {
            ...prev,
            assigned_to: assignTo,
            due_date: dueDate || null,
            priority: priority || 'medium',
            assigned_by: (update.assigned_by as string | null | undefined) ?? prev.assigned_by,
            assigned_at: (update.assigned_at as string | null | undefined) ?? prev.assigned_at,
          }
        : prev,
    )
    if (assignTo) {
      const nm = members.find((m) => m.id === assignTo)?.name || 'Unknown'
      await writeAuditLog({
        orgId,
        userId,
        action: 'control_assigned',
        entityType: 'governance_control',
        entityId: assign.control_id,
        changes: {
          _actor_name: actorName(profile?.full_name, session?.user?.email),
          control: ctrl?.title,
          assigned_to_name: nm,
          due_date: dueDate || null,
          priority: priority || 'medium',
        },
      })
    }
    setAssignStatus('Saved')
    window.setTimeout(() => setAssignStatus(''), 2000)
  }

  function setTaskValue(taskNumber: number, value: string, field?: string) {
    const key = field ? `task_${taskNumber}_${field}` : `task_${taskNumber}`
    setResponses((prev) => ({ ...prev, [key]: value }))
  }

  async function saveProgress(opts?: { silent?: boolean }) {
    if (!assign || !orgId || !userId || !assign.control_id) return false
    if (!opts?.silent) {
      setBusy('save')
      setError('')
      pushToast('')
    }
    const newStatus = assign.status === 'not_started' ? 'in_progress' : assign.status
    const { error: err } = await sb
      .from('control_assignments')
      .update({ task_responses: responses, status: newStatus })
      .eq('id', assign.id)
    if (err) {
      if (!opts?.silent) setBusy('')
      setError(err.message)
      return false
    }
    setAssign((prev) => (prev ? { ...prev, task_responses: responses, status: newStatus } : prev))
    await writeAuditLog({
      orgId,
      userId,
      action: 'control_updated',
      entityType: 'governance_control',
      entityId: assign.control_id,
      changes: {
        _actor_name: actorName(profile?.full_name, session?.user?.email),
        control: ctrl?.title,
      },
    })
    if (!opts?.silent) {
      setBusy('')
      pushToast('Progress saved.')
    }
    return true
  }

  async function markImplemented() {
    if (!assign || !orgId || !userId || !assign.control_id || complete) return
    setBusy('complete')
    setError('')
    pushToast('')
    const saved = await saveProgress({ silent: true })
    if (!saved) {
      setBusy('')
      return
    }
    const { error: err } = await sb
      .from('control_assignments')
      .update({
        status: 'implemented',
        completed_by: userId,
        completed_at: new Date().toISOString(),
      })
      .eq('id', assign.id)
    if (err) {
      setBusy('')
      setError(err.message)
      return
    }
    setAssign((prev) => (prev ? { ...prev, status: 'implemented' } : prev))
    await writeAuditLog({
      orgId,
      userId,
      action: 'control_implemented',
      entityType: 'governance_control',
      entityId: assign.control_id,
      changes: {
        _actor_name: actorName(profile?.full_name, session?.user?.email),
        control: ctrl?.title,
      },
    })
    setBusy('')
    pushToast('Marked as implemented.')
  }

  async function uploadEvidence(file: File) {
    if (!assign || !orgId || !userId) return
    if (file.size > 5 * 1024 * 1024) {
      setError('File must be under 5MB.')
      return
    }
    setBusy('upload')
    setError('')
    pushToast('')
    const path = `evidence/${orgId}/${assign.id}/${Date.now()}_${file.name}`
    const { error: upErr } = await sb.storage
      .from('governance-reports')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (upErr) {
      setBusy('')
      setError(`Upload failed: ${upErr.message}`)
      return
    }
    const { error: rowErr } = await sb.from('evidence_uploads').insert({
      control_assignment_id: assign.id,
      org_id: orgId,
      system_id: assign.system_id || null,
      file_name: file.name,
      file_path: path,
      file_type: file.type,
      file_size: file.size,
      uploaded_by: userId,
    })
    if (rowErr) {
      setBusy('')
      setError(rowErr.message)
      return
    }
    await loadEvidence(assign.id)
    setBusy('')
    pushToast('Evidence uploaded.')
  }

  async function viewEvidence(filePath: string) {
    const { data } = await sb.storage.from('governance-reports').createSignedUrl(filePath, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function submitSupport() {
    if (!assign || !orgId || !userId || !assign.control_id) return
    const msg = supportMsg.trim()
    if (!msg) {
      setError('Describe what you need help with.')
      return
    }
    setBusy('support')
    setError('')
    pushToast('')
    const { error: err } = await sb.from('support_requests').insert({
      control_assignment_id: assign.id,
      control_id: assign.control_id,
      org_id: orgId,
      system_id: assign.system_id || null,
      client_message: msg,
      requested_by: userId,
    })
    if (err) {
      setBusy('')
      setError(err.message)
      return
    }
    await writeAuditLog({
      orgId,
      userId,
      action: 'support_requested',
      entityType: 'governance_control',
      entityId: assign.system_id || assign.control_id,
      changes: {
        _actor_name: actorName(profile?.full_name, session?.user?.email),
        control: ctrl?.title,
      },
    })
    setSupportMsg('')
    await loadSupport(assign.id)
    setBusy('')
    pushToast('Expert help requested.')
  }

  if (!orgId) {
    return (
      <PageFrame>
        <PageHeader title="Control" description="Organisation context required." />
        <EmptyState title="No organisation" body="Join or create an organisation to manage controls." />
      </PageFrame>
    )
  }

  if (loading) {
    return (
      <PageFrame>
        <PageHeader title="Control" description="Loading assignment" />
        <BrandLoader fill label="Loading control" />
      </PageFrame>
    )
  }

  if (!assign) {
    return (
      <PageFrame>
        <PageHeader
          title="Control"
          description="Assignment not found."
          actions={
            <Link to={backTo}>
              <Button variant="ghost">{backLabel}</Button>
            </Link>
          }
        />
        {error ? <Notice tone="risk" title="Error">{error}</Notice> : null}
        <EmptyState title="Assignment not found" body="It may have been removed, or you may not have access." />
      </PageFrame>
    )
  }

  return (
    <PageFrame railItems={CONTROL_DETAIL_RAIL}>
      <PageHeader
        title={title}
        description={
          <div className={styles.pageMeta}>
            <StatusLabel badge tone={toneFor(assign.status)}>
              {labelCtrlStatus(assign.status)}
            </StatusLabel>
            <span className={styles.pageMetaAsset}>{assetLabel}</span>
          </div>
        }
        actions={
          <Link to={backTo}>
            <Button variant="ghost">{backLabel}</Button>
          </Link>
        }
      />

      {error ? <Notice tone="risk" title="Error">{error}</Notice> : null}

      <div className={styles.page}>
        <Section id="overview" className={styles.block}>
          <div className={styles.grid}>
            <div className={styles.fieldWide}>
              <div className={styles.label}>Description</div>
              <div className={styles.value}>
                {ctrl?.description || assign.notes || 'No description provided.'}
              </div>
            </div>
            {ctrl?.purpose ? (
              <div className={styles.fieldWide}>
                <div className={styles.label}>Purpose</div>
                <div className={styles.value}>{ctrl.purpose}</div>
              </div>
            ) : null}
            <div className={styles.field}>
              <div className={styles.label}>Asset</div>
              <div className={styles.value}>{assetLabel}</div>
            </div>
            <div className={styles.field}>
              <div className={styles.label}>Type</div>
              <div className={styles.value}>{titleCase(ctrl?.control_type) || 'Not set'}</div>
            </div>
            <div className={styles.field}>
              <div className={styles.label}>Pillar</div>
              <div className={styles.value}>{titleCase(ctrl?.pillar) || 'Not set'}</div>
            </div>
            <div className={styles.field}>
              <div className={styles.label}>Priority</div>
              <div className={styles.value}>{titleCase(assign.priority) || 'Medium'}</div>
            </div>
          </div>
        </Section>

        <Section id="assignment" className={styles.block}>
          <div className={styles.work}>
            <div className={styles.workHead}>
              <h2 className={styles.workTitle}>Assignment</h2>
            </div>
            <div className={styles.assignGrid}>
              <div className={styles.fieldControl}>
                <span>Assigned to</span>
                <SelectMenu
                  aria-label="Assigned to"
                  value={assignedTo}
                  placeholder="Unassigned"
                  onChange={setAssignedTo}
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...members.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                />
              </div>
              <div className={styles.fieldControl}>
                <span>Due date</span>
                <DateField
                  aria-label="Due date"
                  value={dueDate}
                  onChange={setDueDate}
                  placeholder="Select date"
                />
              </div>
              <div className={styles.fieldControl}>
                <span>Priority</span>
                <SelectMenu
                  aria-label="Priority"
                  value={priority}
                  onChange={setPriority}
                  options={[
                    { value: 'low', label: 'Low' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'high', label: 'High' },
                    { value: 'critical', label: 'Critical' },
                  ]}
                />
              </div>
            </div>
            {assignInfo ? <p className={styles.saveNote}>{assignInfo}</p> : null}
            {assignStatus ? (
              <p
                className={
                  assignStatus.startsWith('Error')
                    ? `${styles.saveNote} ${styles.saveNoteErr}`
                    : `${styles.saveNote} ${styles.saveNoteOk}`
                }
              >
                {assignStatus}
              </p>
            ) : null}
          </div>
        </Section>

        <Section id="tasks" className={styles.block}>
          <div className={styles.work}>
            <div className={styles.workHead}>
              <h2 className={styles.workTitle}>Tasks</h2>
              {tasks.length > 0 ? (
                <span className={styles.workSub}>
                  {doneCount} of {tasks.length} complete
                </span>
              ) : null}
            </div>

            {tasks.length > 0 ? (
              <div className={styles.progress}>
                <div className={styles.progressRow}>
                  <span className={styles.pct}>{taskPct}%</span>
                  <span className={styles.progressNote}>
                    {doneCount} of {tasks.length} tasks complete
                  </span>
                  {!complete && taskPct === 100 ? (
                    <span className={styles.flag}>Ready to mark as implemented</span>
                  ) : null}
                </div>
                <ProgressMeter value={taskPct} bare size="sm" />
              </div>
            ) : (
              <p className={styles.empty}>No structured tasks for this control.</p>
            )}

            {tasks.length > 0 ? (
              <div className={styles.taskList}>
                {tasks.map((t) => {
                  const key = `task_${t.task_number}`
                  const val = responses[key] || ''
                  return (
                    <div key={t.id} className={styles.task}>
                      <div className={styles.taskHead}>
                        <span className={styles.marker}>{t.task_number}</span>
                        <div>
                          <div className={styles.taskTitle}>{t.title}</div>
                          {t.description ? <div className={styles.taskDesc}>{t.description}</div> : null}
                        </div>
                      </div>
                      <div className={styles.taskBody}>
                        {t.task_type === 'checkbox' ? (
                          <label className={styles.checkRow}>
                            <input
                              type="checkbox"
                              checked={val === 'done'}
                              onChange={(e) => setTaskValue(t.task_number, e.target.checked ? 'done' : '')}
                            />
                            Mark as complete
                          </label>
                        ) : null}
                        {t.task_type === 'select' ? (
                          <div className={`${styles.fieldControl} ${styles.fieldControlNarrow}`}>
                            <span>Response</span>
                            <SelectMenu
                              aria-label={`Task ${t.task_number} response`}
                              value={val}
                              placeholder="Select"
                              onChange={(v) => setTaskValue(t.task_number, v)}
                              options={[
                                { value: '', label: 'Select' },
                                ...(t.options?.options || []).map((o) => ({ value: o, label: o })),
                              ]}
                            />
                          </div>
                        ) : null}
                        {t.task_type === 'text' ? (
                          <label className={`${styles.fieldControl} ${styles.fieldControlWide}`}>
                            <span>Notes</span>
                            <textarea
                              rows={3}
                              value={val}
                              placeholder="Add notes or findings"
                              onChange={(e) => setTaskValue(t.task_number, e.target.value)}
                            />
                          </label>
                        ) : null}
                        {t.task_type === 'fields' ? (
                          <div className={styles.fieldGroup}>
                            {(t.options?.fields || []).map((f) => (
                              <label key={f} className={styles.fieldControl}>
                                <span>{f}</span>
                                <input
                                  type="text"
                                  value={responses[`${key}_${f}`] || ''}
                                  placeholder={fieldHint(f)}
                                  onChange={(e) => setTaskValue(t.task_number, e.target.value, f)}
                                />
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}

            <div className={styles.actions}>
              <Button variant="ghost" pending={busy === 'save'} onClick={() => void saveProgress()}>
                Save progress
              </Button>
              <Button pending={busy === 'complete'} disabled={complete} onClick={() => void markImplemented()}>
                {complete ? 'Implemented' : 'Mark as implemented'}
              </Button>
            </div>
          </div>
        </Section>

        <Section id="evidence" className={styles.block}>
          <div className={styles.work}>
            <div className={styles.workHead}>
              <h2 className={styles.workTitle}>Evidence</h2>
              {evidence.length > 0 ? (
                <span className={styles.workSub}>
                  {evidence.length} file{evidence.length === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>

            {(ctrl?.evidence_types || []).length > 0 ? (
              <p className={styles.workHint}>
                Suggested: {(ctrl?.evidence_types || []).join(', ')}
              </p>
            ) : null}

            {evidence.length === 0 ? (
              <p className={styles.empty}>No evidence uploaded yet.</p>
            ) : (
              <div className={styles.evidenceList}>
                {evidence.map((e) => (
                  <div key={e.id} className={styles.evidenceRow}>
                    <div>
                      <div className={styles.evidenceName}>{e.file_name}</div>
                      <div className={styles.evidenceDate}>
                        {e.uploaded_at ? new Date(e.uploaded_at).toLocaleString() : ''}
                      </div>
                    </div>
                    <button type="button" className={styles.linkBtn} onClick={() => void viewEvidence(e.file_path)}>
                      View
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.upload}>
              <input
                ref={fileRef}
                className={styles.hiddenFile}
                type="file"
                accept=".pdf,.docx,.doc,.png,.jpg,.jpeg"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void uploadEvidence(file)
                  e.target.value = ''
                }}
              />
              <Button variant="ghost" pending={busy === 'upload'} onClick={() => fileRef.current?.click()}>
                Upload evidence
              </Button>
              <p className={styles.uploadNote}>PDF, Word, or image. Max 5MB.</p>
            </div>
          </div>
        </Section>

        <Section id="support" className={styles.block}>
          <div className={styles.work}>
            <div className={styles.workHead}>
              <h2 className={styles.workTitle}>Expert help</h2>
            </div>
            <p className={styles.workHint}>
              Request guidance from RegAnchor when a control needs clarification or specialist review.
            </p>

            {support.length === 0 ? null : (
              <div className={styles.supportList}>
                {support.map((r) => (
                  <div key={r.id} className={styles.supportItem}>
                    <StatusLabel
                      tone={r.status === 'open' ? 'warn' : r.status === 'responded' ? 'ok' : 'neutral'}
                    >
                      {(r.status || 'open').replace(/_/g, ' ')}
                    </StatusLabel>
                    <div className={styles.supportMsg}>{r.client_message}</div>
                    {r.mla_response ? (
                      <div className={styles.supportReply}>RegAnchor: {r.mla_response}</div>
                    ) : null}
                    <div className={styles.supportWhen}>
                      {r.requested_at ? new Date(r.requested_at).toLocaleString() : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <label className={styles.fieldControl}>
              <span>Message</span>
              <textarea
                rows={3}
                value={supportMsg}
                placeholder="Describe what you need help with"
                onChange={(e) => setSupportMsg(e.target.value)}
              />
            </label>
            <div className={styles.actions}>
              <Button pending={busy === 'support'} onClick={() => void submitSupport()}>
                Request expert help
              </Button>
            </div>
          </div>
        </Section>
      </div>

      <ToastStack items={toasts} onDismiss={dismissToast} />
    </PageFrame>
  )
}
