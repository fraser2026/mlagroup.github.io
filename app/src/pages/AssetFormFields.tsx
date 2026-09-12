import { SelectMenu } from '../ui'
import { BrandIcon } from '../icons/BrandIcon'
import type { AssetFormValues, ProviderCatalogRow } from '../lib/registry'
import {
  DEPLOYMENT_OPTIONS,
  PURPOSE_OPTIONS,
  TIER_LABELS,
  labelLifecycle,
  labelProvider,
  modelsForPlatform,
  notesRequired,
  suggestedTierForPurpose,
} from '../lib/registry'
import styles from './RegistryForm.module.css'

type Props = {
  form: AssetFormValues
  providers: ProviderCatalogRow[]
  error?: string
  onChange: (next: AssetFormValues) => void
}

export function AssetFormFields({ form, providers, error, onChange }: Props) {
  const models = modelsForPlatform(form.provider_slug)
  const suggested = suggestedTierForPurpose(form.purpose_category)
  const showRationale = !!(form.risk_tier && suggested && form.risk_tier !== suggested)
  const notesNeed = notesRequired(form.provider_slug, form.model_name)

  function set<K extends keyof AssetFormValues>(key: K, value: AssetFormValues[K]) {
    onChange({ ...form, [key]: value })
  }

  function onPurpose(purpose: string) {
    const next = { ...form, purpose_category: purpose }
    const sug = suggestedTierForPurpose(purpose)
    if (sug) next.risk_tier = sug
    onChange(next)
  }

  function onProvider(slug: string) {
    onChange({ ...form, provider_slug: slug, model_name: '' })
  }

  const purposeGroups = Array.from(new Set(PURPOSE_OPTIONS.map((p) => p.group || 'Other'))).map((g) => ({
    label: g,
    options: PURPOSE_OPTIONS.filter((p) => (p.group || 'Other') === g).map((p) => ({
      value: p.value,
      label: p.label,
    })),
  }))

  const providerOptions = [
    { value: '', label: 'Select provider' },
    ...providers.map((p) => {
      const name = labelProvider(p.slug, p.name)
      return {
        value: p.slug,
        label: name,
        icon: <BrandIcon slug={p.slug} size={16} title={name} />,
      }
    }),
  ]

  const modelOptions = [
    { value: '', label: 'Select model' },
    ...models.map((m) => ({ value: m.id, label: m.label })),
  ]

  return (
    <div className={styles.form}>
      <div className={styles.divider}>
        <span>Identity</span>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>
          Name<span className={styles.req}>*</span>
        </span>
        <input
          className={styles.input}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Customer support agent"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Description</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="What does this asset do?"
        />
      </label>

      <div className={styles.divider}>
        <span>Technology</span>
      </div>
      <div className={styles.row}>
        <div className={styles.field}>
          <span className={styles.label}>
            Provider<span className={styles.req}>*</span>
          </span>
          <SelectMenu
            aria-label="Provider"
            value={form.provider_slug}
            onChange={onProvider}
            placeholder="Select provider"
            options={providerOptions}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>
            Model<span className={styles.req}>*</span>
          </span>
          <SelectMenu
            aria-label="Model"
            value={form.model_name}
            onChange={(v) => set('model_name', v)}
            placeholder="Select model"
            disabled={!form.provider_slug}
            options={modelOptions}
          />
        </div>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>
          Vendor <span className={styles.hint}>Optional</span>
        </span>
        <input
          className={styles.input}
          value={form.vendor}
          onChange={(e) => set('vendor', e.target.value)}
          placeholder="e.g. Acme Corp if supplied by a third party"
        />
      </label>

      <div className={styles.divider}>
        <span>EU AI Act classification</span>
      </div>
      <div className={styles.field}>
        <span className={styles.label}>Purpose category</span>
        <SelectMenu
          aria-label="Purpose category"
          value={form.purpose_category}
          onChange={onPurpose}
          placeholder="Select purpose (Annex III mapping)"
          groups={[
            { label: 'Choose purpose', options: [{ value: '', label: 'Select purpose (Annex III mapping)' }] },
            ...purposeGroups,
          ]}
        />
      </div>
      {suggested ? (
        <div className={styles.hintBlock}>
          Suggested tier: <strong>{TIER_LABELS[suggested] || suggested}</strong>, based on EU AI Act Annex III.
        </div>
      ) : form.purpose_category === 'other' ? (
        <div className={styles.hintBlock}>Please classify manually.</div>
      ) : null}
      <div className={styles.row}>
        <div className={styles.field}>
          <span className={styles.label}>Risk tier</span>
          <SelectMenu
            aria-label="Risk tier"
            value={form.risk_tier}
            onChange={(v) => set('risk_tier', v)}
            options={[
              { value: '', label: 'Not classified' },
              { value: 'unacceptable', label: 'Unacceptable' },
              { value: 'high', label: 'High' },
              { value: 'limited', label: 'Limited' },
              { value: 'minimal', label: 'Minimal' },
            ]}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Lifecycle</span>
          <SelectMenu
            aria-label="Lifecycle"
            value={form.lifecycle}
            onChange={(v) => set('lifecycle', v)}
            options={DEPLOYMENT_OPTIONS.map((s) => ({ value: s, label: labelLifecycle(s) }))}
          />
        </div>
      </div>
      {showRationale ? (
        <label className={styles.field}>
          <span className={styles.label}>Classification rationale</span>
          <textarea
            className={styles.textarea}
            rows={2}
            value={form.risk_tier_rationale}
            onChange={(e) => set('risk_tier_rationale', e.target.value)}
            placeholder="Why was this tier assigned?"
          />
        </label>
      ) : null}

      <div className={styles.divider}>
        <span>Governance metadata</span>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>
            System owner<span className={styles.req}>*</span>
          </span>
          <input
            className={styles.input}
            value={form.system_owner}
            onChange={(e) => set('system_owner', e.target.value)}
            placeholder="Named accountable individual"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Department</span>
          <input
            className={styles.input}
            value={form.department}
            onChange={(e) => set('department', e.target.value)}
            placeholder="e.g. Operations, Risk"
          />
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>
          Notes{notesNeed ? <span className={styles.req}>*</span> : null}
        </span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Any additional context"
        />
      </label>

      {error ? <div className={styles.error}>{error}</div> : null}
    </div>
  )
}
