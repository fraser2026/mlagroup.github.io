import { PageFrame, PageHeader, Notice } from '../ui'
import { usePageChrome } from '../ui/shellChrome'

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  usePageChrome({ title, breadcrumbs: [{ label: title }] })
  return (
    <PageFrame>
      <PageHeader title={title} description={description} />
      <Notice title="Coming in migration">
        This route is reserved in the new app shell. Use the legacy portal for write flows until this surface is
        migrated.
      </Notice>
    </PageFrame>
  )
}
