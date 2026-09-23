import { Link } from 'react-router-dom'
import { PageFrame, PageHeader, Section } from '@ra/ui'
import { usePageChrome } from '@ra/ui/shellChrome'

export function HomePage() {
  usePageChrome({ title: 'Overview', breadcrumbs: [{ label: 'Overview' }] })

  return (
    <PageFrame>
      <PageHeader
        title="Control Centre"
        description="Two lanes on purpose: Methodology catalogues for the platform, and Engines for scoring products that stay separate."
      />
      <Section
        id="methodology"
        title="Methodology"
        description="Controls, frameworks, mappings, and policy templates. Customer app, assessments, and dossiers consume this catalogue."
      >
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ra-text-2)', fontSize: 13, lineHeight: 1.55 }}>
          <li>
            <Link to="/controls">Controls</Link> — titles, evidence types, trigger rules
          </li>
          <li>
            <Link to="/frameworks">Frameworks</Link> — obligations and article references
          </li>
          <li>
            <Link to="/mappings">Mappings</Link> — control ↔ obligation join for dossier governance basis
          </li>
          <li>
            <Link to="/policies">Policy templates</Link> — catalogue surface
          </li>
          <li>
            <Link to="/methodology-versions">Versions</Link> — publish named catalogue snapshots for dossier provenance
          </li>
        </ul>
      </Section>
      <Section
        id="engines"
        title="Engines"
        description="Scoring products. Kept separate from methodology so diagnostic weights never get mixed into control ↔ article maps."
      >
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ra-text-2)', fontSize: 13, lineHeight: 1.55 }}>
          <li>
            <Link to="/diagnostic-scoring">Diagnostic scoring</Link> — section weights and sector multipliers
          </li>
          <li>
            <Link to="/diagnostic-regs">Diagnostic regs</Link> — PDF regulatory overview rows
          </li>
          <li>
            <Link to="/diagnostic-questions">Diagnostic questions</Link> — org-wide risk funnel questionnaire
          </li>
          <li>
            <Link to="/assessment-questions">Asset assessment questions</Link> — per-AI-asset questionnaire (scoring keys stable)
          </li>
        </ul>
      </Section>
    </PageFrame>
  )
}
