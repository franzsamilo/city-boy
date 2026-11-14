'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { compute, isoToUTC, type Config, type RatePoint } from '@/lib/budget';
import { fmtDay, fmtMonthShort, peso, rateTxt } from '@/lib/format';

const H = 210;
const PAD = { l: 46, r: 14, t: 14, b: 24 };

function niceStep(raw: number) {
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * 10 ** exp;
}

/** What this plan would save at each day's rate over the last ~90 days. */
export default function SavingsChart({ cfg, history }: { cfg: Config; history: RatePoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => setW(Math.max(260, Math.round(svg.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  const target = Math.max(0, Number(cfg.savingsTarget) || 0);
  const points = useMemo(() => history.map((h) => ({ ...h, t: isoToUTC(h.date), savings: compute(cfg, h.rate).savings })), [cfg, history]);

  if (points.length < 2) {
    return (
      <>
        <svg ref={svgRef} className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="No rate history yet">
          <text x={W / 2} y={H / 2} textAnchor="middle" className="empty">
            Rate history shows up once the rate service answers.
          </text>
        </svg>
        <p className="chart-readout"> </p>
      </>
    );
  }

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const ys = points.map((p) => p.savings);
  let lo = Math.min(target, ...ys);
  let hi = Math.max(target, ...ys);
  const span = hi - lo || 2000;
  lo -= span * 0.15;
  hi += span * 0.15;
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;

  const X = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r);
  const Y = (v: number) => PAD.t + ((hi - v) / (hi - lo || 1)) * (H - PAD.t - PAD.b);

  const yTicks: number[] = [];
  for (let v = lo; v <= hi + 1e-6; v += step) yTicks.push(v);
  const xTicks: number[] = [];
  const d0 = new Date(t0);
  for (let m = d0.getUTCMonth() + 1; ; m++) {
    const t = Date.UTC(d0.getUTCFullYear(), m, 1);
    if (t > t1) break;
    xTicks.push(t);
  }

  const coords = points.map((p) => [X(p.t), Y(p.savings)] as const);
  const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const base = Y(lo);
  const area = `${line}L${coords[coords.length - 1][0].toFixed(1)},${base}L${coords[0][0].toFixed(1)},${base}Z`;
  const shown = points[hover ?? points.length - 1];
  const [ex, ey] = coords[coords.length - 1];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    let bestD = Infinity;
    coords.forEach(([cx], i) => {
      const d = Math.abs(cx - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <>
      <svg
        ref={svgRef}
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Savings at each day's exchange rate over the last 90 days"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line className="grid-line" x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} />
            <text x={PAD.l - 8} y={Y(v) + 3.5} textAnchor="end">
              ₱{+(v / 1000).toFixed(1)}K
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={X(t)} x2={X(t)} y1={H - PAD.b} y2={H - PAD.b + 4} />
            <text x={X(t)} y={H - 6} textAnchor="middle">
              {fmtMonthShort(t)}
            </text>
          </g>
        ))}
        <path className="area" d={area} />
        <path className="line" d={line} />
        <line className="target-line" x1={PAD.l} x2={W - PAD.r} y1={Y(target)} y2={Y(target)} />
        <text className="target-label" x={PAD.l + 6} y={Y(target) - 5}>
          goal {peso(target)}
        </text>
        {hover != null ? (
          <>
            <line className="guide" x1={coords[hover][0]} x2={coords[hover][0]} y1={PAD.t} y2={H - PAD.b} />
            <circle className="guide-dot" r={4} cx={coords[hover][0]} cy={coords[hover][1]} />
          </>
        ) : null}
        <circle className="end-dot" r={4.5} cx={ex} cy={ey} />
      </svg>
      <p className="chart-readout">
        <b>{fmtDay(shown.date)}</b> · $1 = {rateTxt(shown.rate)} · saves <b>{peso(shown.savings)}</b>
      </p>
    </>
  );
}
