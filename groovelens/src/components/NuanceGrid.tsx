"use client";

import { useEffect, useRef } from "react";
import type { GrooveResult, NotePair } from "@/lib/groove";
import { FEATURE_LABEL, INSTRUMENTS, type FeatureId } from "@/lib/profiles";
import { COLORS, SEVERITY_COLOR, SEVERITY_TEXT } from "@/lib/theme";
import { PanelTitle } from "./Insights";

function cellText(f: FeatureId, p: NotePair): string {
  const d = p.diff[f];
  if (d === undefined) return "–";
  if (f === "length") return `${d >= 0 ? "+" : ""}${Math.round((d / Math.max(1, p.pro.lengthMs)) * 100)}%`;
  if (f === "velocity") return `${d >= 0 ? "+" : ""}${d.toFixed(1)}`;
  return `${d >= 0 ? "+" : ""}${Math.round(d)}`;
}

const UNIT_HINT: Record<FeatureId, string> = {
  timing: "ms（−早い / ＋遅い）",
  velocity: "dB（−弱い / ＋強い）",
  attack: "ms（＋立ち上がりが遅い）",
  length: "%（−短い / ＋長い）",
  pitch: "cent（−低い / ＋高い）",
};

export default function NuanceGrid({ result, selected, onSelect }: { result: GrooveResult | null; selected: number | null; onSelect: (i: number) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const feats = result ? INSTRUMENTS[result.instrument].features : [];

  useEffect(() => {
    if (selected === null || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-col="${selected}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [selected]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#11161d] p-4">
      <PanelTitle
        right={
          <span className="flex items-center gap-3 text-[10px] text-zinc-500">
            {(["good", "warning", "critical"] as const).map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEVERITY_COLOR[s] }} />
                {SEVERITY_TEXT[s]}
              </span>
            ))}
          </span>
        }
      >
        ニュアンス・マップ（1音ごと × 5つの観点で先生と比較）
      </PanelTitle>
      {!result ? (
        <div className="flex h-28 items-center justify-center text-sm text-zinc-500">1音ずつ、タイミング・強弱・アタック・音の長さ（ボーカルはピッチも）の差を一覧にします</div>
      ) : (
        <div ref={scrollRef} className="overflow-x-auto">
          <table className="border-separate border-spacing-[2px] text-[10px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[118px] bg-[#11161d] pr-2 text-left font-medium text-zinc-500">位置（小節.拍）</th>
                {result.pairs.map((p) => (
                  <th
                    key={p.index}
                    data-col={p.index}
                    className={`min-w-[40px] cursor-pointer rounded px-0.5 py-0.5 text-center font-mono font-normal ${
                      selected === p.index ? "bg-zinc-200 text-zinc-900" : p.sub === 0 ? "text-zinc-300" : "text-zinc-600"
                    }`}
                    onClick={() => onSelect(p.index)}
                    title={p.posLabel}
                  >
                    {p.bar}.{p.beat}
                    {p.sub ? <sup>{"·".repeat(p.sub)}</sup> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {feats.map((f) => (
                <tr key={f}>
                  <th className="sticky left-0 z-10 bg-[#11161d] pr-2 text-left font-normal">
                    <div className="text-[11px] font-semibold text-zinc-200">{FEATURE_LABEL[f]}</div>
                    <div className="text-[9px] text-zinc-500">{UNIT_HINT[f]}</div>
                  </th>
                  {result.pairs.map((p) => {
                    const sev = p.sev[f];
                    const col = sev ? SEVERITY_COLOR[sev] : COLORS.grid;
                    const isSel = selected === p.index;
                    return (
                      <td
                        key={p.index}
                        onClick={() => onSelect(p.index)}
                        className="h-8 cursor-pointer rounded text-center font-mono tabular-nums"
                        style={{
                          background: sev ? `${col}${sev === "good" ? "26" : sev === "warning" ? "4d" : "73"}` : "#161c24",
                          color: sev === "good" || !sev ? COLORS.textMuted : COLORS.text,
                          outline: isSel ? "1.5px solid #e4e4e7" : undefined,
                        }}
                        title={`${p.posLabel} / ${FEATURE_LABEL[f]}: ${cellText(f, p)}`}
                      >
                        {p.anchor && f === "timing" ? "基準" : cellText(f, p)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
