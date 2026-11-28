"use client";

import { useState } from "react";
import type { Advice, GrooveResult, SubScores } from "@/lib/groove";
import { COLORS, SEVERITY_COLOR, fmtMs, severityOf } from "@/lib/theme";

// ---------------------------------------------------------------------------
// スコア（ヒーロー数値）
// ---------------------------------------------------------------------------

function grade(score: number) {
  if (score >= 90) return { label: "PRO LEVEL", color: COLORS.good };
  if (score >= 75) return { label: "GROOVY", color: COLORS.good };
  if (score >= 55) return { label: "GETTING THERE", color: COLORS.warning };
  return { label: "KEEP PRACTICING", color: COLORS.critical };
}

export function ScoreCard({ result }: { result: GrooveResult | null }) {
  const score = result?.score ?? 0;
  const g = grade(score);
  const R = 62;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-[#11161d] p-4">
      <PanelTitle>グルーヴ一致度スコア</PanelTitle>
      <div className="flex flex-1 items-center justify-center gap-5">
        <div className="relative h-40 w-40">
          <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
            <circle cx="80" cy="80" r={R} fill="none" stroke={COLORS.grid} strokeWidth="10" />
            {result && (
              <circle
                cx="80"
                cy="80"
                r={R}
                fill="none"
                stroke={g.color}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${(C * score) / 100} ${C}`}
                style={{ transition: "stroke-dasharray 0.8s ease" }}
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-5xl font-bold tabular-nums text-zinc-50">{result ? score : "--"}</span>
            <span className="text-[11px] text-zinc-500">/ 100</span>
          </div>
        </div>
        <div className="flex flex-col gap-2 text-xs">
          {result ? (
            <>
              <span
                className="w-fit rounded px-2 py-0.5 text-[10px] font-bold tracking-wider"
                style={{ background: `${g.color}22`, color: g.color }}
              >
                {g.label}
              </span>
              <Stat k="平均ズレ" v={fmtMs(result.meanMs)} />
              <Stat k="平均絶対ズレ" v={`${Math.round(result.meanAbsMs)}ms`} />
              <Stat k="ばらつき (SD)" v={`±${Math.round(result.stdMs)}ms`} />
              <Stat k="推定テンポ" v={`${Math.round(result.bpm)} BPM`} />
              <Stat k="一致した音" v={`${result.pairs.length} / ${result.proOnsets.length}`} />
            </>
          ) : (
            <span className="max-w-[10rem] text-zinc-500">2つの音源を読み込むと自動で解析します</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-w-[9rem] justify-between gap-3">
      <span className="text-zinc-500">{k}</span>
      <span className="font-mono tabular-nums text-zinc-200">{v}</span>
    </div>
  );
}

export function PanelTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">{children}</h2>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ノリの傾向ゲージ（前ノリ ←→ 後ノリ）
// ---------------------------------------------------------------------------

const RANGE = 50; // ±50ms

export function TendencyGauge({ result }: { result: GrooveResult | null }) {
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
  const label = t === "rush" ? "前ノリ（走り気味）" : t === "drag" ? "後ノリ（もたり気味）" : t === "stable" ? "安定（ジャスト）" : "—";
  const labelColor = t === "stable" ? COLORS.good : t ? COLORS.warning : COLORS.textMuted;

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-[#11161d] p-4">
      <PanelTitle>ノリの傾向</PanelTitle>
      <svg viewBox="0 0 260 150" className="mx-auto w-full max-w-[300px]" role="img" aria-label={`平均ズレ ${fmtMs(meanMs)}、${label}`}>
        <path d={arc(-RANGE, RANGE)} stroke={COLORS.grid} strokeWidth="14" fill="none" strokeLinecap="round" />
        {/* 安定ゾーン ±8ms */}
        <path d={arc(-8, 8)} stroke={COLORS.good} strokeOpacity="0.35" strokeWidth="14" fill="none" />
        {/* 平均±SD のばらつき帯 */}
        {result && (
          <path
            d={arc(meanMs - sd, meanMs + sd, r + 14)}
            stroke={COLORS.text}
            strokeOpacity="0.35"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
        )}
        {[-RANGE, -25, 0, 25, RANGE].map((ms) => {
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
          <g style={{ transition: "all 0.6s ease" }}>
            <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#f4f4f5" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx={cx} cy={cy} r="6" fill="#f4f4f5" stroke={COLORS.panel} strokeWidth="2" />
          </g>
        )}
      </svg>
      <div className="mt-1 text-center">
        <div className="font-mono text-2xl font-semibold tabular-nums text-zinc-50">{result ? fmtMs(meanMs) : "--"}</div>
        <div className="text-xs font-medium" style={{ color: labelColor }}>{label}</div>
        {result && <div className="mt-0.5 text-[10px] text-zinc-500">外側の帯 = 平均 ± ばらつき（{Math.round(sd)}ms）</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// レーダーチャート（グルーヴ要素）
// ---------------------------------------------------------------------------

const AXES: { key: keyof SubScores; label: string }[] = [
  { key: "accuracy", label: "タイミング精度" },
  { key: "stability", label: "安定性" },
  { key: "pocket", label: "ノリの重心" },
  { key: "completeness", label: "音数一致" },
  { key: "dynamics", label: "強弱" },
];

export function GrooveRadar({ result }: { result: GrooveResult | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const cx = 130;
  const cy = 112;
  const R = 76;
  const n = AXES.length;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const p = (i: number, v: number) => [cx + R * (v / 100) * Math.cos(ang(i)), cy + R * (v / 100) * Math.sin(ang(i))] as const;
  const vals = AXES.map((a) => (result ? result.sub[a.key] : 0));
  const poly = vals.map((v, i) => p(i, v).join(",")).join(" ");

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-[#11161d] p-4">
      <PanelTitle>グルーヴ要素</PanelTitle>
      <svg viewBox="0 0 260 220" className="mx-auto w-full max-w-[300px]">
        {[25, 50, 75, 100].map((lv) => (
          <polygon
            key={lv}
            points={AXES.map((_, i) => p(i, lv).join(",")).join(" ")}
            fill="none"
            stroke={COLORS.grid}
            strokeWidth="1"
          />
        ))}
        {AXES.map((a, i) => {
          const [x, y] = p(i, 100);
          const [lx, ly] = p(i, 122);
          return (
            <g key={a.key}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={COLORS.grid} />
              <text x={lx} y={ly} fill={COLORS.text} fontSize="10" textAnchor="middle" dominantBaseline="middle">
                {a.label}
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
        {hover !== null && result ? `${AXES[hover].label}: ${Math.round(vals[hover])} / 100` : ""}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ズレ推移チャート（ノートごとの棒）
// ---------------------------------------------------------------------------

export function DeviationChart({ result }: { result: GrooveResult | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const pairs = result?.pairs ?? [];
  const W = 760;
  const H = 170;
  const padL = 40;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const maxAbs = Math.max(30, ...pairs.map((p) => Math.abs(p.devMs)));
  const lim = Math.ceil(maxAbs / 10) * 10;
  const y = (ms: number) => padT + ((lim - ms) / (2 * lim)) * (H - padT - padB);
  const slot = pairs.length ? (W - padL - padR) / pairs.length : 0;
  const bw = Math.max(2, Math.min(18, slot - 2));
  const ticks = [-lim, -lim / 2, 0, lim / 2, lim];

  return (
    <div className="flex flex-col rounded-xl border border-zinc-800 bg-[#11161d] p-4">
      <PanelTitle
        right={
          result && (
            <button type="button" onClick={() => setShowTable((s) => !s)} className="text-[11px] text-emerald-400 hover:text-emerald-300">
              {showTable ? "チャート表示" : "表で見る"}
            </button>
          )
        }
      >
        ノートごとのズレ推移（上 = 後ノリ / 下 = 前ノリ）
      </PanelTitle>
      {!result ? (
        <div className="flex h-[170px] items-center justify-center text-sm text-zinc-500">解析結果がここに表示されます</div>
      ) : showTable ? (
        <div className="max-h-[220px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#11161d] text-zinc-500">
              <tr>
                <th className="py-1 pr-2 font-medium">#</th>
                <th className="py-1 pr-2 font-medium">位置</th>
                <th className="py-1 pr-2 font-medium">Pro (s)</th>
                <th className="py-1 pr-2 font-medium">User (s)</th>
                <th className="py-1 pr-2 text-right font-medium">ズレ</th>
              </tr>
            </thead>
            <tbody className="font-mono text-zinc-300">
              {pairs.map((p) => (
                <tr key={p.index} className="border-t border-zinc-800/70">
                  <td className="py-1 pr-2">{p.index + 1}</td>
                  <td className="py-1 pr-2 font-sans">{p.bar}小節 {p.beat}拍{p.offbeat ? "裏" : ""}</td>
                  <td className="py-1 pr-2">{p.proTime.toFixed(3)}</td>
                  <td className="py-1 pr-2">{(p.userTime - result.offsetSec).toFixed(3)}</td>
                  <td className="py-1 pr-2 text-right">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: SEVERITY_COLOR[severityOf(p.devMs)] }} />
                    {fmtMs(p.devMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.axis : COLORS.grid} strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={padL - 6} y={y(t)} fill={COLORS.textMuted} fontSize="9" textAnchor="end" dominantBaseline="middle" fontFamily="ui-monospace, monospace">
                  {t > 0 ? `+${t}` : t}
                </text>
              </g>
            ))}
            {pairs.map((p, i) => {
              const cx = padL + slot * (i + 0.5);
              const y0 = y(0);
              const y1 = y(p.devMs);
              const top = Math.min(y0, y1);
              const h = Math.max(1.5, Math.abs(y1 - y0));
              const col = SEVERITY_COLOR[severityOf(p.devMs)];
              return (
                <g key={p.index} onMouseEnter={() => setHover(i)}>
                  <rect x={cx - slot / 2} y={padT} width={slot} height={H - padT - padB} fill={hover === i ? "#ffffff08" : "transparent"} />
                  <rect x={cx - bw / 2} y={top} width={bw} height={h} rx={Math.min(3, bw / 2)} fill={col} opacity={hover === null || hover === i ? 1 : 0.55} />
                  {p.beat === 1 && !p.offbeat && (
                    <text x={cx} y={H - 6} fill={COLORS.textMuted} fontSize="9" textAnchor="middle">
                      {p.bar}小節
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover !== null && pairs[hover] && (
            <div
              className="pointer-events-none absolute top-1 rounded-md border border-zinc-700 bg-zinc-900/95 px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: `${Math.min(85, ((padL + slot * (hover + 0.5)) / W) * 100)}%`, transform: "translateX(-50%)" }}
            >
              <span className="text-zinc-400">
                #{pairs[hover].index + 1} {pairs[hover].bar}小節 {pairs[hover].beat}拍{pairs[hover].offbeat ? "裏" : ""}
              </span>
              <span className="ml-2 font-mono text-zinc-100">{fmtMs(pairs[hover].devMs)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 改善アドバイス
// ---------------------------------------------------------------------------

const LEVEL_META: Record<Advice["level"], { icon: string; color: string; label: string }> = {
  good: { icon: "✓", color: COLORS.good, label: "GOOD" },
  warning: { icon: "!", color: COLORS.warning, label: "改善" },
  critical: { icon: "!!", color: COLORS.critical, label: "要改善" },
  info: { icon: "i", color: COLORS.proBright, label: "ヒント" },
};

export function AdvicePanel({ result }: { result: GrooveResult | null }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-[#11161d] p-4">
      <PanelTitle>改善アドバイス</PanelTitle>
      {!result ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">解析後にアドバイスを自動生成します</div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {result.advice.map((a, i) => {
            const m = LEVEL_META[a.level];
            return (
              <li key={i} className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                <span
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold"
                  style={{ background: `${m.color}22`, color: m.color }}
                  aria-hidden
                >
                  {m.icon}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-100">{a.title}</span>
                    <span className="rounded px-1.5 text-[9px] font-bold tracking-wider" style={{ color: m.color, background: `${m.color}18` }}>
                      {m.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">{a.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
