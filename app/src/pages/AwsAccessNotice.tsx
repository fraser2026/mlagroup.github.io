import { Notice } from '../ui'
import { accessStep, type ModelAccess } from '../lib/aws'
import page from './RegistryDetailPage.module.css'

/** The step someone with AWS console access must take before Claude calls succeed. Renders nothing when ready. */
export function AwsAccessNotice({ access, region }: { access?: ModelAccess; region: string }) {
  const step = accessStep(access, region)
  if (!step) return null
  return (
    <Notice tone="warn" title={step.title}>
      {step.body}
      {step.link ? (
        <>
          {' '}
          <a className={page.cardLink} href={step.link.href} target="_blank" rel="noreferrer">
            {step.link.label}
          </a>
        </>
      ) : null}
    </Notice>
  )
}
