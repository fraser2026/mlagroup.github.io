import { useEffect, useState } from 'react'
import { Link } from 'lucide-react'
import { Button } from './Button'
import { DelayTip } from './DelayTip'
import { Icon } from './Icon'
import styles from './CopyLink.module.css'

type Props = {
  className?: string
}

export function CopyLink({ className }: Props) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(t)
  }, [copied])

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
    } catch {
      /* ignore */
    }
  }

  return (
    <DelayTip text={copied ? 'Copied' : 'Copy'} mode="always">
      <Button
        variant="ghost"
        size="sm"
        className={className}
        onClick={() => void onCopy()}
        selected={copied}
        aria-label={copied ? 'Link copied' : 'Copy link to this page'}
      >
        <Icon icon={Link} size="sm" />
        <span className={styles.label}>{copied ? 'Copied' : 'Copy link'}</span>
      </Button>
    </DelayTip>
  )
}
