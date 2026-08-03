import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Liveline } from 'liveline';
import {
  CHART_META,
  getSeriesForCurrency,
  nearestMilestone,
  valueAtProgress,
  valueAtTime
} from './data.js';

const DRAW_MS = 1400;
const DAY_PAD = 86400 * 21;
const SNAP_SECS = 50 * 86400;
const PAD = { top: 22, right: 56, bottom: 30, left: 8 };

function formatMoney(millions, currency) {
  if (millions == null || Number.isNaN(millions)) return '—';
  const sym = currency === 'GBP' ? '£' : '€';
  const v = Number(millions);
  if (v >= 1000) return `${sym}${(v / 1000).toFixed(2)}bn`;
  if (v >= 100) return `${sym}${Math.round(v)}m`;
  if (v >= 10) return `${sym}${v.toFixed(1)}m`;
  return `${sym}${v.toFixed(1)}m`;
}

function formatMonth(ts) {
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** One series + one value for header, detail, and tooltip (no mismatch). */
function resolveHover(euPts, ukPts, time, currency) {
  const euM = nearestMilestone(euPts, time);
  const ukM = nearestMilestone(ukPts, time);
  const de = Math.abs(euM.time - time);
  const du = Math.abs(ukM.time - time);
  const useUk = du < de;
  const pts = useUk ? ukPts : euPts;
  const milestone = useUk ? ukM : euM;
  const dist = useUk ? du : de;
  const seriesId = useUk ? 'uk' : 'eu';
  const value = dist <= SNAP_SECS ? milestone.value : valueAtTime(pts, time);
  const detail =
    dist <= SNAP_SECS
      ? milestone.detail
      : `${formatMoney(value, currency)} cumulative — ${formatMonth(time)}`;

  return {
    seriesId,
    value,
    time: dist <= SNAP_SECS ? milestone.time : time,
    milestone: { ...milestone, seriesId, detail }
  };
}

export default function FinesChart() {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const [currency, setCurrency] = useState('GBP');
  const [inView, setInView] = useState(false);
  const [draw, setDraw] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [hover, setHover] = useState(null);
  const [frozen, setFrozen] = useState(false);

  const pack = useMemo(() => getSeriesForCurrency(currency), [currency]);
  const primaryData = pack.series[0].data;
  const chartFinal = primaryData[primaryData.length - 1].value;

  const windowSecs = useMemo(() => {
    const all = [...pack.eu, ...pack.uk];
    const minT = Math.min(...all.map((p) => p.time));
    const maxT = Math.max(...all.map((p) => p.time));
    return Math.ceil(maxT - minT) + DAY_PAD;
  }, [pack]);

  const livelineSeries = useMemo(
    () =>
      pack.series.map((s) => {
        const data = s.data.map(({ time, value }) => ({ time, value }));
        return {
          id: s.id,
          label: '',
          color: s.color,
          data,
          value: data[data.length - 1].value
        };
      }),
    [pack]
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: '40px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    setDraw(0);
    setDrawn(false);
    setFrozen(false);
    setHover(null);
  }, [currency]);

  useEffect(() => {
    if (!inView || drawn) return undefined;
    let raf = 0;
    const start = performance.now();
    const tick = (now) => {
      const raw = Math.min(1, (now - start) / DRAW_MS);
      setDraw(easeOutCubic(raw));
      if (raw < 1) raf = requestAnimationFrame(tick);
      else {
        setDraw(1);
        setDrawn(true);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, drawn, currency]);

  useEffect(() => {
    if (!drawn) return undefined;
    // Let Liveline settle live tip values, then freeze historic view
    const id = setTimeout(() => setFrozen(true), 200);
    return () => clearTimeout(id);
  }, [drawn, currency]);

  const formatValue = useCallback((v) => formatMoney(v, currency), [currency]);

  const onHover = useCallback(
    (point) => {
      if (!drawn || !point) {
        setHover(null);
        return;
      }
      const resolved = resolveHover(pack.eu, pack.uk, point.time, currency);
      const box = canvasRef.current?.getBoundingClientRect();
      const stageW = box?.width ?? 640;
      const stageH = box?.height ?? 260;
      setHover({
        ...resolved,
        x: point.x,
        y: point.y,
        stageW,
        stageH
      });
    },
    [drawn, pack, currency]
  );

  const liveCounter = valueAtProgress(primaryData, draw);
  const topLine = hover ? hover.value : drawn ? chartFinal : liveCounter;
  const displayValue = formatMoney(topLine, currency);
  const displayLabel = hover?.milestone?.label || (hover ? formatMonth(hover.time) : null);
  const displayDetail = hover?.milestone?.detail || CHART_META.subtitle;
  const authority = hover?.milestone?.authority;
  const seriesTag =
    hover?.seriesId === 'uk' ? 'UK FCA / ICO' : hover ? 'EU GDPR' : null;

  let badgeStyle = null;
  if (hover) {
    const badgeW = 172;
    const badgeH = 72;
    const gap = 12;
    const flipLeft = hover.x > hover.stageW * 0.62;
    const flipBelow = hover.y < 72;
    const left = flipLeft
      ? clamp(hover.x - gap, badgeW + 8, hover.stageW - 8)
      : clamp(hover.x + gap, 8, hover.stageW - badgeW - 8);
    const top = flipBelow
      ? clamp(hover.y + gap, 8, hover.stageH - badgeH - 8)
      : clamp(hover.y - badgeH - gap, 8, hover.stageH - badgeH - 8);
    badgeStyle = {
      left: `${left}px`,
      top: `${top}px`,
      transform: flipLeft ? 'translateX(-100%)' : 'none'
    };
  }

  return (
    <div className="fines-chart" ref={rootRef}>
      <div className="fines-chart__card">
        <div className="fines-chart__head">
          <div className="fines-chart__titles">
            <div className="fines-chart__eyebrow">{CHART_META.title}</div>
            <div className="fines-chart__value" aria-live="polite">
              {displayValue}
              <span className="fines-chart__value-meta">
                {hover
                  ? `${formatMonth(hover.time)}${authority ? `, ${authority}` : ''}`
                  : `EU total, ${CHART_META.asOf}`}
              </span>
            </div>
            <p className="fines-chart__detail">{displayDetail}</p>
          </div>
          <div className="fines-chart__aside">
            <div className="fines-chart__fx" role="group" aria-label="Currency">
              <button
                type="button"
                className={currency === 'GBP' ? 'fines-chart__fx-btn is-active' : 'fines-chart__fx-btn'}
                aria-pressed={currency === 'GBP'}
                onClick={() => setCurrency('GBP')}
              >
                £ GBP
              </button>
              <button
                type="button"
                className={currency === 'EUR' ? 'fines-chart__fx-btn is-active' : 'fines-chart__fx-btn'}
                aria-pressed={currency === 'EUR'}
                onClick={() => setCurrency('EUR')}
              >
                € EUR
              </button>
            </div>
            <div className="fines-chart__legend" aria-hidden="true">
              <span className="fines-chart__swatch fines-chart__swatch--eu" />
              EU GDPR
              <span className="fines-chart__swatch fines-chart__swatch--uk" />
              UK FCA / ICO
            </div>
          </div>
        </div>

        <div className="fines-chart__canvas" ref={canvasRef}>
          {hover && drawn && (
            <div className="fines-chart__badge" style={badgeStyle} role="status">
              <div className="fines-chart__badge-value">
                {formatMoney(hover.value, currency)}
              </div>
              <div className="fines-chart__badge-label">{displayLabel}</div>
              {(seriesTag || authority) && (
                <div className="fines-chart__badge-auth">
                  {[seriesTag, authority].filter(Boolean).join(', ')}
                </div>
              )}
            </div>
          )}

          <div
            className="fines-chart__reveal"
            style={{ '--fc-draw': inView ? draw : 0 }}
          >
            {/* Dedicated plot wrapper so Liveline always owns the flex height.
                Overlay siblings must never be the stage's last child. */}
            <div className="fines-chart__stage">
              <div className="fines-chart__plot">
                <Liveline
                  key={currency}
                  data={livelineSeries[0].data}
                  value={livelineSeries[0].value}
                  series={livelineSeries}
                  theme="light"
                  color="#533AFD"
                  window={windowSecs}
                  grid
                  scrub={drawn}
                  fill={false}
                  pulse={false}
                  momentum={false}
                  degen={false}
                  badge={false}
                  showValue={false}
                  loading={!inView}
                  paused={frozen}
                  lineWidth={2}
                  lerpSpeed={0.18}
                  seriesToggleCompact
                  formatValue={formatValue}
                  formatTime={formatMonth}
                  onHover={onHover}
                  padding={PAD}
                />
              </div>
            </div>
          </div>
        </div>

        <p className="fines-chart__footnote">
          {currency === 'GBP' ? CHART_META.footnoteGbp : CHART_META.footnoteEur}
        </p>
      </div>
    </div>
  );
}
