"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SourceSlot from "@/components/SourceSlot";
import WaveformView from "@/components/WaveformView";
import { AdvicePanel, DeviationChart, GrooveRadar, ScoreCard, TendencyGauge } from "@/components/Insights";
import { generateDemo, playBuffers, type Playback } from "@/lib/audio";
import { analyzeGroove, type AlignMode } from "@/lib/groove";
import { COLORS } from "@/lib/theme";

type Slot = { buf: AudioBuffer; name: string } | null;
type PlayTarget = "pro" | "user" | "both";

export default function Home() {
  const [pro, setPro] = useState<Slot>(null);
  const [user, setUser] = useState<Slot>(null);
  const [align, setAlign] = useState<AlignMode>("first");
  const [demoLoading, setDemoLoading] = useState(false);
  const [playing, setPlaying] = useState<PlayTarget | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const pbRef = useRef<Playback | null>(null);
  const rafRef = useRef<number | null>(null);

  const result = useMemo(() => {
    if (!pro || !user) return null;
    return analyzeGroove(pro.buf, user.buf, align);
  }, [pro, user, align]);

  const stop = useCallback(() => {
    pbRef.current?.stop();
    pbRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setPlaying(null);
    setPlayhead(null);
  }, []);

  useEffect(() => stop, [stop]);

  const play = (target: PlayTarget) => {
    if (playing === target) return stop();
    stop();
    const offset = result?.offsetSec ?? 0;
    let items: { buffer: AudioBuffer; skip: number }[] = [];
    let base = 0; // 再生開始時点の Pro 時間軸上の位置
    if (target === "pro" && pro) items = [{ buffer: pro.buf, skip: 0 }];
    if (target === "user" && user) {
      items = [{ buffer: user.buf, skip: 0 }];
      base = -offset;
    }
    if (target === "both" && pro && user) {
      base = Math.max(0, -offset);
      items = [
        { buffer: pro.buf, skip: base },
        { buffer: user.buf, skip: base + offset },
      ];
    }
    if (!items.length) return;
    const pb = playBuffers(items, () => {
      if (pbRef.current === pb) stop();
    });
    pbRef.current = pb;
    setPlaying(target);
    const tick = () => {
      const el = pb.ctx.currentTime - pb.startedAt;
      setPlayhead(base + Math.max(0, el));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const loadDemo = async () => {
    stop();
    setDemoLoading(true);
    try {
      const [p, u] = await Promise.all([generateDemo(false), generateDemo(true)]);
      setPro({ buf: p, name: "demo_pro_just_96bpm.wav（ジャスト）" });
      setUser({ buf: u, name: "demo_user_rushing_96bpm.wav（ズレあり）" });
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07090c] text-zinc-200">
      {/* ヘッダー（DAW のトランスポートバー風） */}
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#0b0f14]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-4 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <Logo />
            <div>
              <div className="text-base font-bold tracking-tight text-zinc-50">
                Groove<span className="text-emerald-400">Lens</span>
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Timing Nuance Analyzer</div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadDemo}
              disabled={demoLoading}
              className="rounded-md bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-emerald-950 shadow-[0_0_20px_rgba(16,185,129,0.25)] transition hover:bg-emerald-400 disabled:opacity-60"
            >
              {demoLoading ? "生成中…" : "デモ音源をロード"}
            </button>
            <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => play("both")}
                disabled={!pro || !user}
                className={`rounded px-3 py-1 font-medium transition disabled:opacity-40 ${
                  playing === "both" ? "bg-cyan-500/20 text-cyan-200" : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {playing === "both" ? "■ 停止" : "▶ 重ねて再生"}
              </button>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-400">
              開始位置
              <select
                value={align}
                onChange={(e) => setAlign(e.target.value as AlignMode)}
                className="bg-transparent text-zinc-200 outline-none"
              >
                <option value="first" className="bg-zinc-900">最初の音で揃える</option>
                <option value="none" className="bg-zinc-900">揃えない（絶対時刻）</option>
              </select>
            </label>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1400px] flex-col gap-4 px-5 py-5">
        {/* 1. 音源読み込み */}
        <section className="grid gap-4 md:grid-cols-2">
          <SourceSlot
            role="pro"
            title="お手本音源（Pro）"
            subtitle="基準となるプロの演奏 / クリック"
            color={COLORS.pro}
            buffer={pro?.buf ?? null}
            name={pro?.name ?? null}
            onLoad={(buf, name) => {
              stop();
              setPro({ buf, name });
            }}
            onPlay={() => play("pro")}
            playing={playing === "pro"}
          />
          <SourceSlot
            role="user"
            title="自分の演奏（User）"
            subtitle="同じフレーズを演奏した音源"
            color={COLORS.user}
            buffer={user?.buf ?? null}
            name={user?.name ?? null}
            onLoad={(buf, name) => {
              stop();
              setUser({ buf, name });
            }}
            onPlay={() => play("user")}
            playing={playing === "user"}
          />
        </section>

        {/* 2. 波形 & オンセット */}
        <section className="rounded-xl border border-zinc-800 bg-[#11161d] p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">波形 & オンセット比較</h2>
            {result && (
              <span className="font-mono text-[11px] text-zinc-500">
                検出: Pro {result.proOnsets.length} / User {result.userOnsets.length} 音 · 抜け {result.missed.length} · 余分{" "}
                {result.extra.length}
                {align === "first" && ` · User を ${(result.offsetSec * 1000).toFixed(0)}ms シフト`}
              </span>
            )}
          </div>
          <WaveformView proBuf={pro?.buf ?? null} userBuf={user?.buf ?? null} result={result} playhead={playhead} />
        </section>

        {/* 3. スコア / 傾向 / 要素 */}
        <section className="grid gap-4 lg:grid-cols-3">
          <ScoreCard result={result} />
          <TendencyGauge result={result} />
          <GrooveRadar result={result} />
        </section>

        {/* 4. 推移 & アドバイス */}
        <section className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <DeviationChart result={result} />
          </div>
          <div className="lg:col-span-2">
            <AdvicePanel result={result} />
          </div>
        </section>

        <footer className="pb-4 pt-2 text-center text-[10px] text-zinc-600">
          すべての解析はブラウザ内（Web Audio API）で完結し、音声はサーバーに送信されません。
        </footer>
      </main>
    </div>
  );
}

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0f172a" />
      <path d="M4 16h4l2-7 3 14 3-10 2 6 2-3h8" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="16" r="2.2" fill="#10b981" />
    </svg>
  );
}
