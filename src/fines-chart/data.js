/**
 * UK & EU regulatory fines — stair-step series in millions of the active currency.
 *
 * EU values are absolute cumulative levels (EUR millions) from public GDPR
 * enforcement-tracker baselines, not a running sum of selected mega-fines.
 * UK values are absolute cumulative levels (GBP millions) of FCA year totals
 * plus landmark ICO penalties.
 *
 * Chart units: millions. €6.31bn ⇒ value 6310.
 */

/** Unix seconds (Liveline) */
function t(y, m, d = 1) {
  return Math.floor(Date.UTC(y, m - 1, d, 12, 0, 0) / 1000);
}

const DAY = 86400;

/** Fixed reference rate for chart comparability (not a live FX feed). */
export const GBP_PER_EUR = 0.86;
export const EUR_PER_GBP = +(1 / GBP_PER_EUR).toFixed(4);

/**
 * @typedef {'GBP' | 'EUR'} Currency
 * @typedef {{
 *   time: number,
 *   levelEur?: number,
 *   levelGbp?: number,
 *   label: string,
 *   detailGbp: string,
 *   detailEur: string,
 *   authority: string,
 *   isJump?: boolean
 * }} LevelPoint
 */

/**
 * Build a stair series from absolute cumulative levels (never sum deltas).
 * @param {LevelPoint[]} levels
 * @param {Currency} currency
 * @param {number} startTime
 * @param {number} endTime
 */
function buildLevelStairs(levels, currency, startTime, endTime) {
  const sorted = [...levels].sort((a, b) => a.time - b.time);
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  let prev = 0;

  out.push({
    time: startTime,
    value: 0,
    label: 'Baseline',
    detail: 'Cumulative series starts at zero before the first published landmark',
    authority: '—',
    isJump: false
  });

  for (const lv of sorted) {
    const raw =
      currency === 'GBP'
        ? lv.levelGbp ?? (lv.levelEur ?? 0) * GBP_PER_EUR
        : lv.levelEur ?? (lv.levelGbp ?? 0) * EUR_PER_GBP;
    // Absolute level only — never add to previous (prevents compounding bugs)
    const level = +Math.max(prev, raw).toFixed(2);

    const holdT = Math.max(startTime + DAY, lv.time - DAY);
    if (out[out.length - 1].time < holdT) {
      out.push({
        time: holdT,
        value: prev,
        label: out[out.length - 1].label,
        detail: 'Quiet investigation period — cumulative held flat',
        authority: out[out.length - 1].authority,
        isJump: false
      });
    }

    if (out[out.length - 1].time < lv.time) {
      out.push({
        time: lv.time - 1,
        value: prev,
        label: lv.label,
        detail: currency === 'GBP' ? lv.detailGbp : lv.detailEur,
        authority: lv.authority,
        isJump: false
      });
    }

    out.push({
      time: lv.time,
      value: level,
      label: lv.label,
      detail: currency === 'GBP' ? lv.detailGbp : lv.detailEur,
      authority: lv.authority,
      isJump: true
    });
    out.push({
      time: lv.time + 3600,
      value: level,
      label: lv.label,
      detail: currency === 'GBP' ? lv.detailGbp : lv.detailEur,
      authority: lv.authority,
      isJump: true
    });

    prev = level;
  }

  const peak = prev;
  // Hold the peak flat to endTime (and a short tip past it) so Liveline's
  // live head stays on the plateau — never dive back to zero.
  const tip = Math.max(endTime, out[out.length - 1].time + DAY);
  if (out[out.length - 1].time < tip) {
    out.push({
      time: tip,
      value: peak,
      label: 'Current',
      detail: 'Held flat through this month. Imposed tracker totals, not net of all appeals.',
      authority: out[out.length - 1].authority,
      isJump: false
    });
  }
  out.push({
    time: tip + DAY * 3,
    value: peak,
    label: 'Current',
    detail: 'Held flat through this month. Imposed tracker totals, not net of all appeals.',
    authority: out[out.length - 1].authority,
    isJump: false
  });

  return out;
}

/**
 * EU / EEA GDPR cumulative fines — absolute levels in EUR millions.
 * Anchored to CMS (~€6.11bn Mar 2026) and Enforcement Tracker (~€6.31bn mid-2026).
 * Levels are absolute cumulatives (not summed deltas) and strictly increasing.
 */
const EU_LEVELS = [
  {
    time: t(2019, 1, 21),
    levelEur: 180,
    label: 'Early GDPR wave',
    detailEur: '€0.18bn cumulative — early GDPR monetary penalties incl. Google CNIL €50m',
    detailGbp: '£0.15bn cumulative — early GDPR monetary penalties incl. Google CNIL',
    authority: 'EU DPAs'
  },
  {
    time: t(2020, 12, 15),
    levelEur: 720,
    label: '2020 run-rate',
    detailEur: '€0.72bn cumulative — tracker run-rate through late 2020',
    detailGbp: '£0.62bn cumulative — tracker run-rate through late 2020',
    authority: 'EU DPAs'
  },
  {
    time: t(2021, 7, 16),
    levelEur: 1680,
    label: 'Amazon — Luxembourg',
    detailEur: '€1.68bn cumulative — includes CNPD Amazon €746m (later annulled; path kept monotonic)',
    detailGbp: '£1.44bn cumulative — includes CNPD Amazon fine (later annulled; path kept monotonic)',
    authority: 'CNPD (LU)'
  },
  {
    time: t(2021, 9, 2),
    levelEur: 1980,
    label: 'WhatsApp — Ireland',
    detailEur: '€1.98bn cumulative — after Irish DPC WhatsApp €225m',
    detailGbp: '£1.70bn cumulative — after Irish DPC WhatsApp fine',
    authority: 'DPC (IE) / EDPB'
  },
  {
    time: t(2022, 9, 2),
    levelEur: 2680,
    label: 'Instagram — Ireland',
    detailEur: '€2.68bn cumulative — after Irish DPC Instagram €405m',
    detailGbp: '£2.30bn cumulative — after Irish DPC Instagram fine',
    authority: 'DPC (IE)'
  },
  {
    time: t(2022, 11, 25),
    levelEur: 3020,
    label: 'Meta — Ireland',
    detailEur: '€3.02bn cumulative — after Meta scraping / security €265m',
    detailGbp: '£2.60bn cumulative — after Meta scraping / security fine',
    authority: 'DPC (IE)'
  },
  {
    time: t(2023, 1, 4),
    levelEur: 3480,
    label: 'Meta ads — Ireland',
    detailEur: '€3.48bn cumulative — after Meta behavioural-ads €390m',
    detailGbp: '£2.99bn cumulative — after Meta behavioural-ads fine',
    authority: 'DPC (IE) / EDPB'
  },
  {
    time: t(2023, 5, 22),
    levelEur: 4780,
    label: 'Meta transfers — Ireland',
    detailEur: '€4.78bn cumulative — after record Meta EU–US transfers €1.2bn',
    detailGbp: '£4.11bn cumulative — after record Meta EU–US transfers fine',
    authority: 'DPC (IE) / EDPB'
  },
  {
    time: t(2023, 9, 1),
    levelEur: 5220,
    label: 'TikTok — Ireland',
    detailEur: '€5.22bn cumulative — after TikTok children\'s data €345m',
    detailGbp: '£4.49bn cumulative — after TikTok children\'s data fine',
    authority: 'DPC (IE)'
  },
  {
    time: t(2024, 7, 22),
    levelEur: 5580,
    label: 'Uber — Netherlands',
    detailEur: '€5.58bn cumulative — after Dutch AP Uber €290m',
    detailGbp: '£4.80bn cumulative — after Dutch AP Uber fine',
    authority: 'AP (NL)'
  },
  {
    time: t(2024, 10, 24),
    levelEur: 5780,
    label: 'LinkedIn — Ireland',
    detailEur: '€5.78bn cumulative — after LinkedIn €310m',
    detailGbp: '£4.97bn cumulative — after LinkedIn fine',
    authority: 'DPC (IE)'
  },
  {
    time: t(2024, 12, 17),
    levelEur: 5920,
    label: 'Meta — Ireland',
    detailEur: '€5.92bn cumulative — after Meta 2018 incident €251m',
    detailGbp: '£5.09bn cumulative — after Meta 2018 incident fine',
    authority: 'DPC (IE)'
  },
  {
    time: t(2025, 5, 2),
    levelEur: 6020,
    label: 'TikTok — Ireland',
    detailEur: '€6.02bn cumulative — after TikTok China-transfers €530m',
    detailGbp: '£5.18bn cumulative — after TikTok China-transfers fine',
    authority: 'DPC (IE)'
  },
  {
    time: t(2026, 3, 1),
    levelEur: 6110,
    label: 'CMS ET Report',
    detailEur: '€6.11bn — CMS Enforcement Tracker Report (Mar 2026 cut-off)',
    detailGbp: '£5.25bn — CMS Enforcement Tracker Report (Mar 2026 cut-off)',
    authority: 'CMS ET'
  },
  {
    time: t(2026, 8, 1),
    levelEur: 6310,
    label: 'Tracker total',
    detailEur: '€6.31bn — GDPR Enforcement Tracker public cumulative total (approx.)',
    detailGbp: '£5.43bn — GDPR Enforcement Tracker cumulative total converted (approx.)',
    authority: 'Enforcement Tracker'
  }
];

/** UK cumulative — absolute GBP millions (FCA year totals + landmark ICO). */
const UK_LEVELS = [
  {
    time: t(2019, 12, 31),
    levelGbp: 391.8,
    label: 'FCA fines — 2019',
    detailGbp: '£391.8m cumulative — FCA 2019 calendar-year penalties',
    detailEur: '€455m cumulative — FCA 2019 calendar-year penalties',
    authority: 'FCA (UK)'
  },
  {
    time: t(2020, 10, 16),
    levelGbp: 411.8,
    label: 'British Airways — ICO',
    detailGbp: '£411.8m cumulative — after ICO BA £20m',
    detailEur: '€479m cumulative — after ICO BA fine',
    authority: 'ICO (UK)'
  },
  {
    time: t(2020, 10, 30),
    levelGbp: 430.2,
    label: 'Marriott — ICO',
    detailGbp: '£430.2m cumulative — after ICO Marriott £18.4m',
    detailEur: '€500m cumulative — after ICO Marriott fine',
    authority: 'ICO (UK)'
  },
  {
    time: t(2020, 12, 31),
    levelGbp: 622.8,
    label: 'FCA fines — 2020',
    detailGbp: '£622.8m cumulative — after FCA 2020 year total',
    detailEur: '€724m cumulative — after FCA 2020 year total',
    authority: 'FCA (UK)'
  },
  {
    time: t(2021, 12, 31),
    levelGbp: 1199.7,
    label: 'FCA fines — 2021',
    detailGbp: '£1.20bn cumulative — after FCA 2021 year total',
    detailEur: '€1.39bn cumulative — after FCA 2021 year total',
    authority: 'FCA (UK)'
  },
  {
    time: t(2022, 5, 23),
    levelGbp: 1207.2,
    label: 'Clearview AI — ICO',
    detailGbp: '£1.21bn cumulative — after ICO Clearview £7.5m',
    detailEur: '€1.40bn cumulative — after ICO Clearview fine',
    authority: 'ICO (UK)'
  },
  {
    time: t(2022, 12, 31),
    levelGbp: 1423.0,
    label: 'FCA fines — 2022',
    detailGbp: '£1.42bn cumulative — after FCA 2022 year total',
    detailEur: '€1.65bn cumulative — after FCA 2022 year total',
    authority: 'FCA (UK)'
  },
  {
    time: t(2023, 4, 4),
    levelGbp: 1435.7,
    label: 'TikTok — ICO',
    detailGbp: '£1.44bn cumulative — after ICO TikTok £12.7m',
    detailEur: '€1.67bn cumulative — after ICO TikTok fine',
    authority: 'ICO (UK)'
  },
  {
    time: t(2023, 12, 31),
    levelGbp: 1488.5,
    label: 'FCA fines — 2023',
    detailGbp: '£1.49bn cumulative — after FCA 2023 year total',
    detailEur: '€1.73bn cumulative — after FCA 2023 year total',
    authority: 'FCA (UK)'
  },
  {
    time: t(2024, 12, 31),
    levelGbp: 1664.5,
    label: 'FCA fines — 2024',
    detailGbp: '£1.66bn cumulative — after FCA 2024 year total',
    detailEur: '€1.93bn cumulative — after FCA 2024 year total',
    authority: 'FCA (UK)'
  },
  {
    time: t(2025, 8, 1),
    levelGbp: 1788.7,
    label: 'FCA fines — 2025 YTD',
    detailGbp: '£1.79bn cumulative — after FCA 2025 YTD published total',
    detailEur: '€2.08bn cumulative — after FCA 2025 YTD published total',
    authority: 'FCA (UK)'
  }
];

const START = t(2019, 1, 1);
/** Last landmark date in the curated series (Aug 2026 tracker total). */
const SERIES_END = t(2026, 8, 1);

/**
 * @param {Currency} currency
 */
export function getSeriesForCurrency(currency) {
  // Pin the flat hold through "now" so Liveline's live tip sits on the plateau
  // and the full plot width maps to the series (no dead zone on the right).
  const end = Math.max(SERIES_END, Math.floor(Date.now() / 1000) + 86400);
  const euData = buildLevelStairs(EU_LEVELS, currency, START, end);
  const ukData = buildLevelStairs(UK_LEVELS, currency, START, end);

  // Single source of truth: final point of the built array
  const finalEu = euData[euData.length - 1].value;
  const finalUk = ukData[ukData.length - 1].value;

  return {
    currency,
    eu: euData,
    uk: ukData,
    finalEu,
    finalUk,
    series: [
      {
        id: 'eu',
        label: 'EU GDPR',
        color: '#533AFD',
        data: euData,
        value: finalEu
      },
      {
        id: 'uk',
        label: 'UK FCA / ICO',
        color: '#0A2540',
        data: ukData,
        value: finalUk
      }
    ]
  };
}

export const CHART_META = {
  title: 'UK & EU regulatory fines',
  subtitle: 'Scrub the chart to explore major EU GDPR and UK FCA / ICO decisions over time.',
  footnoteGbp:
    'Selected landmark penalties, shown as running totals. EU figures converted at €1 = £0.86. Sources include the GDPR Enforcement Tracker (~€6.31bn mid-2026) and published FCA / ICO notices. Not a live feed.',
  footnoteEur:
    'Selected landmark penalties, shown as running totals. UK figures converted at £1 = €1.16. Sources include the GDPR Enforcement Tracker (~€6.31bn mid-2026) and published FCA / ICO notices. Not a live feed.',
  asOf: 'August 2026'
};

export function nearestMilestone(points, time) {
  const jumps = points.filter((p) => p.isJump);
  const pool = jumps.length ? jumps : points;
  let best = pool[0] ?? points[0];
  let bestDist = Math.abs(best.time - time);
  for (const p of pool) {
    const d = Math.abs(p.time - time);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/** Value of the stair series at a unix-second timestamp (last point ≤ time). */
export function valueAtTime(points, time) {
  if (!points.length) return 0;
  let v = points[0].value;
  for (const p of points) {
    if (p.time <= time) v = p.value;
    else break;
  }
  return v;
}

export function valueAtProgress(points, progress) {
  if (!points.length) return 0;
  if (progress <= 0) return points[0].value;
  if (progress >= 1) return points[points.length - 1].value;
  const t0 = points[0].time;
  const t1 = points[points.length - 1].time;
  const cut = t0 + (t1 - t0) * progress;
  return valueAtTime(points, cut);
}
