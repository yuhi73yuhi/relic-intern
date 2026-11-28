"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AccuracyPanel from "@/components/AccuracyPanel";
import { GrooveRadar, SummaryPanel, TendencyGauge } from "@/components/Insights";
import NoteDetail from "@/components/NoteDetail";
import NuanceGrid from "@/components/NuanceGrid";
import { OshiiPanel, ScoreCard } from "@/components/Oshii";
import SourceSlot from "@/components/SourceSlot";
import WaveformView from "@/components/WaveformView";
import { playBuffers, type Playback } from "@/lib/audio";
import { analyzeGroove, type AlignMode, type GrooveResult } from "@/lib/groove";
import { GENRES, INSTRUMENTS, INSTRUMENT_ORDER, type GenreId, type InstrumentId } from "@/lib/profiles";
import { checkQuality } from "@/lib/quality";
import { generateDemoSet } from "@/lib/synth";
import { COLORS } from "@/lib/theme";

type Slot = { buf: AudioBuffer; name: string; demo: boolean } | null;
type PlayTarget = "pro" | "user" | "both";

/** 選択の初期値: 一番の惜しいポイントの最初の音 */
function defaultSelection(r: GrooveResult | null): number | null {
  if (!r || !r.pairs.length) return null;
  const top = r.issues.find((i) => i.noteIdx.length);
  return top ? top.noteIdx[0] : 0;
}

export default function Home() {
  const [instrument, setInstrument] = useState<InstrumentId>("drums");
  const [genre, setGenre] = useState<GenreId>("funk");
  const [pro, setPro] = useState<Slot>(null);
  const [user, setUser] = useState<Slot>(null);
  const [align, setAlign] = useState<AlignMode>("first");
  const [phoneSim, setPhoneSim] = useState(true);
  const [demoLoading, setDemoLoading] = useState(false);
  const [playing, setPlaying] = useState<PlayTarget | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [sel, setSel] = useState<{ r: GrooveResult | null; i: number | null }>({ r: null, i: null });
  const pbRef = useRef<Playback | null>(null);
  const rafRef = useRef<number | null>(null);

  const result = useMemo(() => {
    if (!pro || !user) return null;
    return analyzeGroove(pro.buf, user.buf, instrument, genre, align);
  }, [pro, user, instrument, genre, align]);
  const selected = sel.r === result ? sel.i : defaultSelection(result);
  const select = (i: number) => setSel({ r: result, i });

  const proQ = useMemo(() => (pro ? checkQuality(pro.buf) : null), [pro]);
  const userQ = useMemo(() => (user ? checkQuality(user.buf) : null), [user]);

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
    let base = 0;
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
      setPlayhead(base + Math.max(0, pb.ctx.currentTime - pb.startedAt));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const loadDemo = async (inst = instrument, g = genre, phone = phoneSim) => {
    stop();
    setDemoLoading(true);
    try {
      const d = await generateDemoSet(inst, g, { phone });
      const tag = `${INSTRUMENTS[inst].label}×${GENRES[g].label}`;
      setPro({ buf: d.teacher, name: `デモ: 先生のお手本（${tag}）`, demo: true });
      setUser({ buf: d.student, name: `デモ: 生徒の演奏（${tag}）`, demo: true });
    } finally {
      setDemoLoading(false);
    }
  };

  const changeInstrument = (i: InstrumentId) => {
    const g = INSTRUMENTS[i].genres.includes(genre) ? genre : INSTRUMENTS[i].genres[0];
    setInstrument(i);
    setGenre(g);
    if (pro?.demo && user?.demo) void loadDemo(i, g);
  };
  const changeGenre = (g: GenreId) => {
    setGenre(g);
    if (pro?.demo && user?.demo) void loadDemo(instrument, g);
  };

  const inst = INSTRUMENTS[instrument];
  const gen = GENRES[genre];

  return (
    <div className="min-h-screen bg-[#07090c] text-zinc-200">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#0b0f14]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <Logo />
            <div>
              <div className="text-base font-bold tracking-tight text-zinc-50">
                Groove<span className="text-emerald-400">Lens</span>
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Nuance Analyzer</div>
            </div>
          </div>

          {/* 楽器 × ジャンル */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5" role="radiogroup" aria-label="楽器">
              {INSTRUMENT_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={instrument === id}
                  onClick={() => changeInstrument(id)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    instrument === id ? "bg-emerald-500/20 text-emerald-200" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {INSTRUMENTS[id].label}
                </button>
              ))}
            </div>
            <span className="text-zinc-600">×</span>
            <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5" role="radiogroup" aria-label="ジャンル">
              {inst.genres.map((g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={genre === g}
                  onClick={() => changeGenre(g)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    genre === g ? "bg-cyan-500/20 text-cyan-200" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {GENRES[g].label}
                </button>
              ))}
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <input type="checkbox" checked={phoneSim} onChange={(e) => setPhoneSim(e.target.checked)} className="accent-emerald-500" />
              スマホ録音を再現
            </label>
            <button
              type="button"
              onClick={() => loadDemo()}
              disabled={demoLoading}
              className="rounded-md bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-emerald-950 shadow-[0_0_20px_rgba(16,185,129,0.25)] transition hover:bg-emerald-400 disabled:opacity-60"
            >
              {demoLoading ? "生成中…" : "デモ音源をロード"}
            </button>
            <button
              type="button"
              onClick={() => play("both")}
              disabled={!pro || !user}
              className={`rounded-md border border-zinc-800 px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                playing === "both" ? "bg-cyan-500/20 text-cyan-200" : "bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {playing === "both" ? "■ 停止" : "▶ 重ねて再生"}
            </button>
            <select
              value={align}
              onChange={(e) => setAlign(e.target.value as AlignMode)}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300 outline-none"
              aria-label="開始位置の揃え方"
            >
              <option value="first">最初の音で揃える</option>
              <option value="none">揃えない</option>
            </select>
          </div>
        </div>
        <div className="border-t border-zinc-800/70 bg-[#0a0d11]">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-1 px-5 py-1.5 text-[11px] text-zinc-400">
            <span>
              <span className="font-semibold text-cyan-300">{gen.label}のノリ：</span>
              {gen.groove}
            </span>
            <span className="text-zinc-500">
              判定の物差し: ±{gen.tightMs}ms = タイト / {gen.div === 4 ? "16分" : gen.div === 3 ? "3連" : "8分"}グリッド
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1400px] flex-col gap-4 px-5 py-5">
        <section className="grid gap-4 md:grid-cols-2">
          <SourceSlot
            role="pro"
            title="先生のお手本"
            subtitle={`先生が${inst.label}1本で録音した演奏（市販音源は使いません）`}
            color={COLORS.pro}
            buffer={pro?.buf ?? null}
            name={pro?.name ?? null}
            quality={proQ}
            onLoad={(buf, name) => {
              stop();
              setPro({ buf, name, demo: false });
            }}
            onPlay={() => play("pro")}
            playing={playing === "pro"}
          />
          <SourceSlot
            role="user"
            title="あなたの演奏"
            subtitle="同じフレーズをスマホで録音（楽器1本だけ）"
            color={COLORS.user}
            buffer={user?.buf ?? null}
            name={user?.name ?? null}
            quality={userQ}
            onLoad={(buf, name) => {
              stop();
              setUser({ buf, name, demo: false });
            }}
            onPlay={() => play("user")}
            playing={playing === "user"}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-4">
          <ScoreCard result={result} />
          <div className="lg:col-span-3">
            <OshiiPanel result={result} onFocus={select} />
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-[#11161d] p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">波形を並べて比較（クリックで音を選択）</h2>
            {result && (
              <span className="font-mono text-[11px] text-zinc-500">
                検出: 先生 {result.proOnsets.length} / あなた {result.userOnsets.length} 音 · 抜け {result.missed.length} · 余分 {result.extra.length}
                {align === "first" && ` · 録音開始のズレ ${(result.offsetSec * 1000).toFixed(0)}ms を補正`}
              </span>
            )}
          </div>
          <WaveformView
            proBuf={pro?.buf ?? null}
            userBuf={user?.buf ?? null}
            result={result}
            playhead={playhead}
            selected={selected}
            onSelect={select}
            tightMs={gen.tightMs}
          />
        </section>

        <NuanceGrid result={result} selected={selected} onSelect={select} />

        <section className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <NoteDetail result={result} selected={selected} proBuf={pro?.buf ?? null} userBuf={user?.buf ?? null} />
          </div>
          <div className="lg:col-span-2">
            <GrooveRadar result={result} />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <TendencyGauge result={result} />
          </div>
          <div className="lg:col-span-3">
            <SummaryPanel result={result} />
          </div>
        </section>

        <AccuracyPanel instrument={instrument} genre={genre} />

        <footer className="pb-4 pt-2 text-center text-[10px] text-zinc-600">
          すべての解析はブラウザ内（Web Audio API）で完結し、音声はサーバーに送信されません。お手本には先生ご自身の演奏を使用してください。
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
