import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../ui'
import styles from './SignaturePad.module.css'

type Point = { x: number; y: number }
type Stroke = Point[]

type Props = {
  onChange: (svg: string | null) => void
  disabled?: boolean
}

/** Ink-style signature pad that exports compact SVG path data. */
export function SignaturePad({ onChange, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const strokesRef = useRef<Stroke[]>([])
  const drawingRef = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = '#0A0E14'
    ctx.lineWidth = 1.75
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of strokesRef.current) {
      if (stroke.length < 2) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0].x, stroke[0].y)
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y)
      ctx.stroke()
    }
  }, [])

  useEffect(() => {
    redraw()
    const onResize = () => redraw()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [redraw])

  function emitSvg() {
    const strokes = strokesRef.current
    if (!strokes.length) {
      setHasInk(false)
      onChange(null)
      return
    }
    const parts: string[] = []
    for (const stroke of strokes) {
      if (stroke.length < 2) continue
      let d = `M ${stroke[0].x.toFixed(1)} ${stroke[0].y.toFixed(1)}`
      for (let i = 1; i < stroke.length; i++) {
        d += ` L ${stroke[i].x.toFixed(1)} ${stroke[i].y.toFixed(1)}`
      }
      parts.push(d)
    }
    if (!parts.length) {
      setHasInk(false)
      onChange(null)
      return
    }
    const canvas = canvasRef.current
    const w = canvas?.clientWidth || 360
    const h = canvas?.clientHeight || 120
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none" stroke="#0A0E14" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">` +
      parts.map((d) => `<path d="${d}"/>`).join('') +
      `</svg>`
    setHasInk(true)
    onChange(svg)
  }

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    strokesRef.current.push([pointFromEvent(e)])
    redraw()
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) return
    const stroke = strokesRef.current[strokesRef.current.length - 1]
    if (!stroke) return
    stroke.push(pointFromEvent(e))
    redraw()
  }

  function onPointerUp() {
    if (!drawingRef.current) return
    drawingRef.current = false
    emitSvg()
  }

  function clear() {
    strokesRef.current = []
    setHasInk(false)
    onChange(null)
    redraw()
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label}>Signature</span>
        <Button type="button" variant="ghost" size="sm" disabled={disabled || !hasInk} onClick={clear}>
          Clear
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        aria-label="Sign here"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <p className={styles.hint}>Sign with your pointer or finger. Clear to redo.</p>
    </div>
  )
}
