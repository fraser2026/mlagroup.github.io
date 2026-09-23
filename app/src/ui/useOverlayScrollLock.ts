import { useEffect } from 'react'

/**
 * Freeze page/shell scroll while a blur/dim overlay is open.
 * Overlay panels that should still scroll use data-ra-scroll="overlay".
 * Ref-counted so nested overlays (drawer + palette) stay locked.
 */
export function useOverlayScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return

    const html = document.documentElement
    const count = Number(html.dataset.raOverlayCount || '0') + 1
    html.dataset.raOverlayCount = String(count)
    html.dataset.raOverlayOpen = '1'

    const freezeTargets = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-ra-scroll="canvas"], [data-ra-scroll="sidebar"], [data-ra-scroll="shell"]',
      ),
    )
    const prevInline = freezeTargets.map((el) => ({
      el,
      overflow: el.style.overflow,
      overscroll: el.style.overscrollBehavior,
    }))
    for (const el of freezeTargets) {
      el.style.overflow = 'hidden'
      el.style.overscrollBehavior = 'none'
    }

    const prevBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onTouchMove = (e: TouchEvent) => {
      const target = e.target
      if (!(target instanceof Element)) {
        e.preventDefault()
        return
      }
      if (target.closest('[data-ra-scroll="overlay"]')) return
      e.preventDefault()
    }
    document.addEventListener('touchmove', onTouchMove, { passive: false })

    const onWheel = (e: WheelEvent) => {
      const target = e.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-ra-scroll="overlay"]')) return
      // Stop background scroll when gesture starts over the dimmed shell.
      if (target.closest('[role="presentation"], [data-ra-overlay-root]')) {
        e.preventDefault()
      }
    }
    document.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      const next = Number(html.dataset.raOverlayCount || '1') - 1
      if (next <= 0) {
        delete html.dataset.raOverlayCount
        delete html.dataset.raOverlayOpen
      } else {
        html.dataset.raOverlayCount = String(next)
      }
      for (const { el, overflow, overscroll } of prevInline) {
        el.style.overflow = overflow
        el.style.overscrollBehavior = overscroll
      }
      document.body.style.overflow = prevBodyOverflow
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('wheel', onWheel)
    }
  }, [locked])
}
