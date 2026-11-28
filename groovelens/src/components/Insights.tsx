"use client";

import { useState } from "react";
import type { GrooveResult } from "@/lib/groove";
import { FEATURE_LABEL, GENRES, INSTRUMENTS } from "@/lib/profiles";
import { COLORS, SEVERITY_COLOR, SEVERITY_ICON, fmtMs } from "@/lib/theme";

export function PanelTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">{children}</h2>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ノリの傾向ゲージ（前ノリ ←→ 後ノリ）
// ---------------------------------------------------------------------------

export function TendencyGauge({ result }: { result: GrooveResult | null }) {
  const tight = result ? GENRES[result.genre].tightMs : 10;
  const RANGE = Math.max(40, tight * 4);
  const cx = 130;
  const cy = 118;
  const r = 96;
  const angOf = (ms: number) => Math.PI * (1 - (Math.max(-RANGE, Math.min(RANGE, ms)) + RANGE) / (2 * RANGE));
  const pt = (ms: number, rr = r) => [cx + rr * Math.cos(angOf(ms)), cy - rr * Math.sin(angOf(ms))] as const;
  const arc = (a: number, b: number, rr = r) => {
    const [x1, y1] = pt(a, rr);
    const [x2, y2] = pt(b, rr);
    return `M ${x1} ${y1} A ${rr} ${rr} 0 0 1 ${x2} ${y2}`;
  };
  const meanMs = result?.meanMs ?? 0;
  const sd = result?.stdMs ?? 0;
  const [nx, ny] = pt(meanMs, r - 18);
  const t = result?.tendency;
  const label = t === "rush" ? "前ノリ（走り気味）" : t === "drag" ? "後ノリ（もたり気味）" : t === "stable" ? "先生とほぼ一致" : "—";
  const labelColor = t === "stable" ? COLORS.good : t ? COLORS.warning : COLORS.textMuted;
  const ticks = [-RANGE, -RANGE / 2, 0, RANGE / 2, RANGE];

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-[#11161d] p-4">
      <PanelTitle>ノリの傾向（先生比）</PanelTitle>
      <svg viewBox="0 0 260 150" className="mx-auto w-full max-w-[300px]" role="img" aria-label={`平均ズレ ${fmtMs(meanMs)}、${label}`}>
        <path d={arc(-RANGE, RANGE)} stroke={COLORS.grid} strokeWidth="14" fill="none" strokeLinecap="round" />
        <path d={arc(-tight, tight)} stroke={COLORS.good} strokeOpacity="0.35" strokeWidth="14" fill="none" />
        {result && (
          <path d={arc(meanMs - sd, meanMs + sd, r + 14)} stroke={COLORS.text} strokeOpacity="0.35" strokeWidth="3" fill="none" strokeLinecap="round" />
        )}
        {ticks.map((ms) => {
          const [x1, y1] = pt(ms, r - 10);
          const [x2, y2] = pt(ms, r + 7);
          const [tx, ty] = pt(ms, r - 24);
          return (
            <g key={ms}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS.axis} strokeWidth="1" />
              <text x={tx} y={ty} fill={COLORS.textMuted} fontSize="9" textAnchor="middle" dominantBaseline="middle" fontFamily="ui-monospace, monospace">
                {ms > 0 ? `+${ms}` : ms}
              </text>
            </g>
          );
        })}
        <text x={cx - r} y={cy + 20} fill={COLORS.textMuted} fontSize="10" textAnchor="middle">前ノリ</text>
        <text x={cx + r} y={cy + 20} fill={COLORS.textMuted} fontSize="10" textAnchor="middle">後ノリ</text>
        {result && (
          <g>
            <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#f4f4f5" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx={cx} cy={cy} r="6" fill="#f4f4f5" stroke={COLORS.panel} strokeWidth="2" />
          </g>
        )}
      </svg>
      <div className="mt-1 text-center">
        <div className="font-mono text-2xl font-semibold tabular-nums text-zinc-50">{result ? fmtMs(meanMs) : "--"}</div>
        <div className="text-xs font-medium" style={{ color: labelColor }}>{label}</div>
        {result && (
          <div className="mt-0.5 text-[10px] text-zinc-500">
            緑の帯 = {GENRES[result.genre].label}のタイト基準 ±{tight}ms / 外側の帯 = ばらつき ±{Math.round(sd)}ms
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// レーダーチャート（ニュアンス別の一致度）
// ---------------------------------------------------------------------------

export function GrooveRadar({ result }: { result: GrooveResult | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const feats = result ? INSTRUMENTS[result.instrument].features : (["timing", "velocity", "attack", "length"] as const);
  const cx = 130;
  const cy = 112;
  const R = 74;
  const n = feats.length;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const p = (i: number, v: number) => [cx + R * (v / 100) * Math.cos(ang(i)), cy + R * (v / 100) * Math.sin(ang(i))] as const;
  const vals = feats.map((f) => (result ? (result.sub[f] ?? 0) : 0));
  const poly = vals.map((v, i) => p(i, v).join(",")).join(" ");

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-[#11161d] p-4">
      <PanelTitle>ニュアンス別の一致度</PanelTitle>
      <svg viewBox="0 0 260 220" className="mx-auto w-full max-w-[300px]">
        {[25, 50, 75, 100].map((lv) => (
          <polygon key={lv} points={feats.map((_, i) => p(i, lv).join(",")).join(" ")} fill="none" stroke={COLORS.grid} strokeWidth="1" />
        ))}
        {feats.map((f, i) => {
          const [x, y] = p(i, 100);
          const [lx, ly] = p(i, 124);
          return (
            <g key={f}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={COLORS.grid} />
              <text x={lx} y={ly} fill={COLORS.text} fontSize="10" textAnchor="middle" dominantBaseline="middle">
                {FEATURE_LABEL[f]}
              </text>
              {result && (
                <text x={lx} y={ly + 12} fill={COLORS.textMuted} fontSize="9" textAnchor="middle" dominantBaseline="middle" fontFamily="ui-monospace, monospace">
                  {Math.round(vals[i])}
                </text>
              )}
            </g>
          );
        })}
        {result && (
          <>
            <polygon points={poly} fill={COLORS.accent} fillOpacity="0.18" stroke={COLORS.accent} strokeWidth="2" strokeLinejoin="round" />
            {vals.map((v, i) => {
              const [x, y] = p(i, v);
              return (
                <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <circle cx={x} cy={y} r="12" fill="transparent" />
                  <circle cx={x} cy={y} r={hover === i ? 5 : 4} fill={COLORS.accent} stroke={COLORS.panel} strokeWidth="2" />
                </g>
              );
            })}
          </>
        )}
      </svg>
      <div className="h-4 text-center text-[11px] text-zinc-400">
        {hover !== null && result ? `${FEATURE_LABEL[feats[hover]]}: ${Math.round(vals[hover])} / 100` : "タイミング以外のニュアンスも採点に含めています"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 総評
// ---------------------------------------------------------------------------

export function SummaryPanel({ result }: { result: GrooveResult | null }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-[#11161d] p-4">
      <PanelTitle>総評</PanelTitle>
      {!result ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">解析後に総評を表示します</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {result.summary.map((s, i) => {
            const col = s.level === "info" ? COLORS.proBright : SEVERITY_COLOR[s.level];
            return (
              <li key={i} className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold"
                  style={{ background: `${col}22`, color: col }}
                  aria-hidden
                >
                  {s.level === "info" ? "i" : SEVERITY_ICON[s.level]}
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-zinc-100">{s.title}</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{s.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
