type Props = {
  values: number[]
  width?: number
  height?: number
  className?: string
}

/** Quiet SVG spark for score / volume trends — Blurple stroke only. */
export function Sparkline({ values, width = 120, height = 36, className }: Props) {
  if (!values.length) {
    return <svg width={width} height={height} className={className} aria-hidden />
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 1)
  const pts = values
    .map((v, i) => {
      const x = values.length === 1 ? width / 2 : (i / (values.length - 1)) * width
      const y = height - ((v - min) / span) * (height - 4) - 2
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} className={className} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline fill="none" stroke="var(--ra-blurple)" strokeWidth="1.75" points={pts} />
    </svg>
  )
}
