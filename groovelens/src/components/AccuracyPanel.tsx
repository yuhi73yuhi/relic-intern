"use client";

import { useState } from "react";
import { runAccuracyTest, type AccuracyReport } from "@/lib/accuracy";
import { GENRES, INSTRUMENTS, INSTRUMENT_ORDER, type GenreId, type InstrumentId } from "@/lib/profiles";
import { COLORS } from "@/lib/theme";
import { PanelTitle } from "./Insights";

const VERDICT = {
  ok: { label: "10ms単位の判定に十分", color: COLORS.good },
  marginal: { label: "条件付きで可", color: COLORS.warning },
  ng: { label: "精度不足", color: COLORS.critical },
} as const;

export default function AccuracyPanel({ instrument, genre }: { instrument: InstrumentId; genre: GenreId }) {
  const [reports, setReports] = useState<AccuracyReport[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const runOne = async () => {
    setBusy("検証中…");
    try {
      const r = await runAccuracyTest(instrument, genre);
      setReports((prev) => [r, ...prev.filter((p) => !(p.instrument === r.instrument && p.genre === r.genre))]);
    } finally {
      setBusy(null);
    }
  };

  const runAll = async () => {
    const out: AccuracyReport[] = [];
    try {
      for (const i of INSTRUMENT_ORDER) {
        for (const g of INSTRUMENTS[i].genres) {
          setBusy(`検証中… ${INSTRUMENTS[i].label} × ${GENRES[g].label}`);
          out.push(await runAccuracyTest(i, g));
          setReports([...out]);
        }
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#11161d] p-4">
      <PanelTitle
        right={
          <div className="flex gap-2">
            <button type="button" onClick={runOne} disabled={!!busy} className="rounded-md border border-emerald-600/60 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">
              {INSTRUMENTS[instrument].label} × {GENRES[genre].label} を検証
            </button>
            <button type="button" onClick={runAll} disabled={!!busy} className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
              全組み合わせを検証
            </button>
          </div>
        }
      >
        精度検証：スマホ録音でも 0.01秒 の差を取り出せるか
      </PanelTitle>
      <p className="mb-3 text-xs leading-relaxed text-zinc-400">
        正解の分かっている演奏を合成し、<b className="text-zinc-200">スマホ内蔵マイク相当の劣化</b>
        （低音カット・高音の減衰・部屋の反響・自動音量調整・雑音・録音開始の遅れ）を加えたうえで解析し、測定値と正解値の差を測ります。各組み合わせ 3 パターンで検証します。
      </p>
      {busy && <div className="mb-2 animate-pulse text-xs text-emerald-300">{busy}</div>}
      {reports.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] text-zinc-500">
              <tr>
                <th className="py-1 text-left font-medium">楽器 × ジャンル</th>
                <th className="py-1 text-right font-medium">検出率</th>
                <th className="py-1 text-right font-medium">タイミング誤差 平均</th>
                <th className="py-1 text-right font-medium">95%の音で</th>
                <th className="py-1 text-right font-medium">最大</th>
                <th className="py-1 text-right font-medium">強弱の誤差</th>
                <th className="py-1 text-right font-medium">判定</th>
              </tr>
            </thead>
            <tbody className="font-mono text-zinc-300">
              {reports.map((r) => {
                const v = VERDICT[r.verdict];
                return (
                  <tr key={`${r.instrument}-${r.genre}`} className="border-t border-zinc-800/70">
                    <td className="py-1.5 font-sans text-zinc-200">
                      {INSTRUMENTS[r.instrument].label} × {GENRES[r.genre].label}
                    </td>
                    <td className="py-1.5 text-right">{((r.detected / Math.max(1, r.notes)) * 100).toFixed(0)}%</td>
                    <td className="py-1.5 text-right">{r.timingMae.toFixed(1)}ms</td>
                    <td className="py-1.5 text-right">≤{r.timingP95.toFixed(1)}ms</td>
                    <td className="py-1.5 text-right">{r.timingMax.toFixed(1)}ms</td>
                    <td className="py-1.5 text-right">{r.velocityMae.toFixed(1)}dB</td>
                    <td className="py-1.5 text-right font-sans">
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: v.color, background: `${v.color}1c` }}>
                        {v.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-zinc-500">
            判定基準: 95%の音で誤差 5ms 以下かつ検出率 90% 以上 →「10ms単位の判定に十分」。※合成音とシミュレーションによる検証です。実機スマホでの録音検証が次のステップです。
          </p>
        </div>
      ) : (
        !busy && <div className="text-xs text-zinc-500">ボタンを押すと検証を実行します（ブラウザ内で数秒〜数十秒）</div>
      )}
    </div>
  );
}
