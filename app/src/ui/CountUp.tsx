import { useEffect, useState } from 'react'

type Props = {
  value: number
  format: (n: number) => string
  durationMs?: number
}

/** Eases a metric up to its value once per change. Static under reduced motion. */
export function CountUp({ value, format, durationMs = 1100 }: Props) {
  const [shown, setShown] = useState(value)

  useEffect(() => {
    if (!Number.isFinite(value) || value <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / durationMs)
      setShown(value * (0.6 + 0.4 * (1 - (1 - k) ** 3)))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, durationMs])

  return <>{format(shown)}</>
}
