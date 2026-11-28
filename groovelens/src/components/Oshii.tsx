"use client";

import { useState } from "react";
import type { GrooveResult, Issue } from "@/lib/groove";
import { FEATURE_LABEL, GENRES, INSTRUMENTS } from "@/lib/profiles";
import { COLORS, SEVERITY_COLOR } from "@/lib/theme";
import { PanelTitle } from "./Insights";

function grade(score: number) {
  if (score >= 90) return { label: "PRO LEVEL", color: COLORS.good };
  if (score >= 75) return { label: "GROOVY", color: COLORS.good };
  if (score >= 55) return { label: "あと一歩", color: COLORS.warning };
  return { label: "伸びしろ大", color: COLORS.critical };
}

/** スコア（ヒーロー数値）+ 惜しいポイントを直した場合の見込み */
export function ScoreCard({ result }: { result: GrooveResult | null }) {
  const score = result?.score ?? 0;
  const g = grade(score);
  const potential = result ? Math.min(100, score + result.issues.slice(0, 3).reduce((s, i) => s + i.gain, 0)) : 0;
  const R = 62;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-[#11161d] p-4">
      <PanelTitle>グルーヴ一致度</PanelTitle>
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="relative h-40 w-40">
          <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
            <circle cx="80" cy="80" r={R} fill="none" stroke={COLORS.grid} strokeWidth="10" />
            {result && (
              <>
                <circle cx="80" cy="80" r={R} fill="none" stroke={g.color} strokeOpacity="0.22" strokeWidth="10" strokeDasharray={`${(C * potential) / 100} ${C}`} />
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
              </>
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-5xl font-bold tabular-nums text-zinc-50">{result ? score : "--"}</span>
            <span className="text-[11px] text-zinc-500">/ 100</span>
          </div>
        </div>
        {result ? (
          <>
            <span className="rounded px-2 py-0.5 text-[10px] font-bold tracking-wider" style={{ background: `${g.color}22`, color: g.color }}>
              {g.label}
            </span>
            {potential > score && (
              <div className="text-center text-xs text-zinc-400">
                惜しいポイント上位3つを直すと
                <div className="mt-0.5 font-mono text-lg font-semibold text-emerald-300">
                  {score} → {potential}点
                </div>
              </div>
            )}
            <div className="text-[10px] text-zinc-500">
              {INSTRUMENTS[result.instrument].label} × {GENRES[result.genre].label} の基準 / 推定 {Math.round(result.bpm)} BPM
            </div>
          </>
        ) : (
          <span className="text-center text-xs text-zinc-500">先生と自分の録音を読み込むと自動で採点します</span>
        )}
      </div>
    </div>
  );
}

function reportText(r: GrooveResult): string {
  const inst = INSTRUMENTS[r.instrument];
  const lines = [
    `【GrooveLens レポート】${inst.label} × ${GENRES[r.genre].label}`,
    `グルーヴ一致度: ${r.score}点`,
    `ニュアンス別: ${inst.features.map((f) => `${FEATURE_LABEL[f]} ${Math.round(r.sub[f] ?? 0)}`).join(" / ")}`,
    "",
    "■ 惜しいポイント（直すと上がる点数順）",
    ...r.issues.slice(0, 5).map((i, k) => `${k + 1}. ${i.title}: ${i.detail} → 直すと +${i.gain}点\n   練習: ${i.tip}`),
    "",
    "■ 総評",
    ...r.summary.map((s) => `・${s.title}`),
  ];
  return lines.join("\n");
}

export function OshiiPanel({ result, onFocus }: { result: GrooveResult | null; onFocus: (noteIndex: number) => void }) {
  const [copied, setCopied] = useState(false);
  const issues = result?.issues ?? [];
  const top = issues.slice(0, 3);
  const rest = issues.slice(3);

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(reportText(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-[#11161d] p-4">
      <PanelTitle
        right={
          result && (
            <button type="button" onClick={copy} className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-emerald-500 hover:text-emerald-300">
              {copied ? "コピーしました" : "先生用レポートをコピー"}
            </button>
          )
        }
      >
        惜しいポイント（直すと上がる点数順）
      </PanelTitle>
      {!result ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
          演奏の「どこが・何が・どれだけ」惜しいかを、ここに表示します
        </div>
      ) : !issues.length ? (
        <div className="flex flex-1 items-center justify-center text-sm text-emerald-300">大きな改善点は見つかりませんでした。先生とほぼ同じノリです！</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="grid gap-2.5 md:grid-cols-3">
            {top.map((iss, k) => (
              <IssueCard key={iss.id} rank={k + 1} issue={iss} onFocus={onFocus} />
            ))}
          </div>
          {rest.length > 0 && (
            <ul className="flex flex-col divide-y divide-zinc-800 rounded-lg border border-zinc-800">
              {rest.map((iss) => (
                <li key={iss.id}>
                  <button
                    type="button"
                    disabled={!iss.noteIdx.length}
                    onClick={() => iss.noteIdx.length && onFocus(iss.noteIdx[0])}
                    className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-xs hover:bg-zinc-800/40"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[iss.severity] }} />
                    <span className="font-medium text-zinc-200">{iss.title}</span>
                    <span className="truncate text-zinc-500">{iss.detail}</span>
                    <span className="ml-auto shrink-0 font-mono text-emerald-300">+{iss.gain}点</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function IssueCard({ rank, issue, onFocus }: { rank: number; issue: Issue; onFocus: (i: number) => void }) {
  const col = SEVERITY_COLOR[issue.severity];
  const feature = issue.feature === "missing" ? "音数" : FEATURE_LABEL[issue.feature];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3" style={{ boxShadow: `inset 3px 0 0 ${col}` }}>
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 font-mono text-[10px] font-bold text-zinc-200">{rank}</span>
        <span className="rounded px-1.5 text-[10px] font-semibold" style={{ color: col, background: `${col}1c` }}>
          {feature}
        </span>
        <span className="ml-auto font-mono text-sm font-bold text-emerald-300">+{issue.gain}点</span>
      </div>
      <div className="text-sm font-semibold leading-snug text-zinc-100">{issue.title}</div>
      <div className="font-mono text-xs text-zinc-300">{issue.detail}</div>
      <p className="text-[11px] leading-relaxed text-zinc-400">{issue.tip}</p>
      {issue.noteIdx.length > 0 && (
        <button
          type="button"
          onClick={() => onFocus(issue.noteIdx[0])}
          className="mt-auto w-fit text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
        >
          該当箇所を見る・聴き比べる →
        </button>
      )}
    </div>
  );
}
