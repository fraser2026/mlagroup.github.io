import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { clsx } from 'clsx'
import styles from './UsageBars.module.css'

export type UsageBar = {
  /** UTC day, YYYY-MM-DD. */
  date: string
  value: number
  /** Extra tooltip lines under the value. */
  detail?: ReactNode
}

type Props = {
  bars: UsageBar[]
  formatValue: (n: number) => string
  /** Bar fill. Defaults to the provider usage orange. */
  color?: string
  height?: number
  emptyLabel?: string
  label: string
  className?: string
}

function niceStep(raw: number) {
  if (raw <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * mag
}

function axisTicks(max: number) {
  const step = niceStep(max / 4)
  const top = Math.max(step, Math.ceil(max / step) * step)
  const ticks: number[] = []
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v)
  return { top, ticks }
}

function parseDay(date: string) {
  return new Date(`${date}T00:00:00Z`)
}

function dayLabel(date: string) {
  return parseDay(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function dayLabelLong(date: string) {
  return parseDay(date).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Indices that get an x-axis label: daily for a week, Mondays for a month, fortnightly beyond. */
function xTickIndices(bars: UsageBar[]) {
  const n = bars.length
  if (n <= 8) return bars.map((_, i) => i)
  const every = n <= 40 ? 7 : 14
  const out: number[] = []
  let seen = 0
  bars.forEach((b, i) => {
    if (parseDay(b.date).getUTCDay() !== 1) return
    if (seen++ % (every / 7) === 0) out.push(i)
  })
  return out
}

/** Daily usage bars: right value axis, weekly dashed guides, bars rise on mount. */
export function UsageBars({
  bars,
  formatValue,
  color = '#ff3d0a',
  height = 132,
  emptyLabel = 'No usage in this window',
  label,
  className,
}: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const max = useMemo(() => bars.reduce((m, b) => Math.max(m, b.value), 0), [bars])
  const { top, ticks } = useMemo(() => axisTicks(max), [max])
  const xTicks = useMemo(() => xTickIndices(bars), [bars])
  const n = Math.max(bars.length, 1)
  const empty = max <= 0
  const active = hover != null ? bars[hover] : null
  const runKey = `${bars.length}:${bars[0]?.date || ''}:${max}`

  return (
    <div
      className={clsx(styles.chart, className)}
      style={
        {
          '--bar': color,
          '--plot-h': `${height}px`,
          '--n': n,
          '--gap': n <= 14 ? '6px' : n <= 40 ? '3px' : '1px',
        } as CSSProperties
      }
      role="img"
      aria-label={label}
    >
      <div className={styles.plot} onMouseLeave={() => setHover(null)}>
        {xTicks.map((i) => (
          <i key={`g${i}`} className={styles.guide} style={{ left: `${((i + 0.5) / n) * 100}%` }} />
        ))}
        <div className={clsx(styles.bars, hover != null && styles.barsHover)} key={runKey}>
          {bars.map((b, i) => (
            <span
              key={b.date}
              className={clsx(styles.col, hover === i && styles.colOn)}
              onMouseEnter={() => setHover(i)}
            >
              {b.value > 0 ? (
                <span
                  className={styles.bar}
                  style={{ height: `${(b.value / top) * 100}%`, '--i': i } as CSSProperties}
                />
              ) : null}
            </span>
          ))}
        </div>
        {empty ? <div className={styles.empty}>{emptyLabel}</div> : null}
        {active && hover != null ? (
          <div
            className={styles.tip}
            style={{ left: `clamp(70px, ${((hover + 0.5) / n) * 100}%, calc(100% - 70px))` }}
          >
            <div className={styles.tipDate}>{dayLabelLong(active.date)}</div>
            <div className={styles.tipValue}>{formatValue(active.value)}</div>
            {active.detail ? <div className={styles.tipDetail}>{active.detail}</div> : null}
          </div>
        ) : null}
      </div>
      <div className={styles.yAxis} aria-hidden>
        {ticks.map((t) => (
          <span key={t} className={styles.yTick} style={{ bottom: `${(t / top) * 100}%` }}>
            {t === 0 ? '0' : formatValue(t)}
          </span>
        ))}
      </div>
      <div className={styles.xAxis} aria-hidden>
        {xTicks.map((i) => (
          <span key={i} className={styles.xTick} style={{ left: `${((i + 0.5) / n) * 100}%` }}>
            {dayLabel(bars[i].date)}
          </span>
        ))}
      </div>
    </div>
  )
}
