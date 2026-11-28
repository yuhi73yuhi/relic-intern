"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GrooveResult, NotePair } from "@/lib/groove";
import { toMono } from "@/lib/groove";
import { COLORS, SEVERITY_COLOR, fmtMs, severityOf } from "@/lib/theme";

type Props = {
  proBuf: AudioBuffer | null;
  userBuf: AudioBuffer | null;
  result: GrooveResult | null;
  /** Pro 時間軸での再生位置（秒） */
  playhead: number | null;
};

const RULER = 22;
const LANE = 120;
const BAND = 52;
const HEIGHT = RULER + LANE + BAND + LANE + 8;
const LANE_PRO_Y = RULER;
const BAND_Y = RULER + LANE;
const LANE_USER_Y = BAND_Y + BAND;

/** 1 ピクセル列ごとの min/max を求める */
function computePeaks(data: Float32Array, sr: number, t0: number, secPerPx: number, cols: number) {
  const mins = new Float32Array(cols);
  const maxs = new Float32Array(cols);
  for (let c = 0; c < cols; c++) {
    const a = Math.floor((t0 + c * secPerPx) * sr);
    const b = Math.floor((t0 + (c + 1) * secPerPx) * sr);
    let mn = 0;
    let mx = 0;
    for (let i = Math.max(0, a); i < Math.min(data.length, b); i++) {
      const v = data[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    mins[c] = mn;
    maxs[c] = mx;
  }
  return { mins, maxs };
}

export default function WaveformView({ proBuf, userBuf, result, playhead }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<{ pair: NotePair; x: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(300, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const proMono = useMemo(() => (proBuf ? toMono(proBuf) : null), [proBuf]);
  const userMono = useMemo(() => (userBuf ? toMono(userBuf) : null), [userBuf]);
  const offset = result?.offsetSec ?? 0;

  const duration = useMemo(() => {
    const p = proBuf?.duration ?? 0;
    const u = userBuf ? userBuf.duration - offset : 0;
    return Math.max(p, u, 1);
  }, [proBuf, userBuf, offset]);

  const canvasW = Math.round(width * zoom);
  const secPerPx = duration / canvasW;
  const xOf = (t: number) => t / secPerPx;

  // 静的レイヤー（波形・グリッド・オンセット）
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = canvasW * dpr;
    cv.height = HEIGHT * dpr;
    cv.style.width = `${canvasW}px`;
    cv.style.height = `${HEIGHT}px`;
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = COLORS.surface;
    g.fillRect(0, 0, canvasW, HEIGHT);

    // ルーラー & 拍グリッド
    g.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.textBaseline = "middle";
    const step = secPerPx * 80 > 1 ? 1 : secPerPx * 80 > 0.5 ? 0.5 : secPerPx * 80 > 0.25 ? 0.25 : 0.1;
    for (let t = 0; t <= duration; t += step) {
      const x = Math.round(xOf(t)) + 0.5;
      g.strokeStyle = COLORS.grid;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, RULER - 6);
      g.lineTo(x, HEIGHT);
      g.stroke();
      g.fillStyle = COLORS.textMuted;
      g.fillText(`${t.toFixed(step < 1 ? 2 : 0)}s`, x + 3, RULER / 2);
    }
    g.strokeStyle = COLORS.axis;
    g.beginPath();
    g.moveTo(0, RULER - 0.5);
    g.lineTo(canvasW, RULER - 0.5);
    g.stroke();

    // 中央バンド
    g.fillStyle = "#0e1319";
    g.fillRect(0, BAND_Y, canvasW, BAND);

    const drawLane = (data: Float32Array | null, sr: number, t0: number, y: number, color: string) => {
      const mid = y + LANE / 2;
      g.strokeStyle = COLORS.grid;
      g.beginPath();
      g.moveTo(0, mid + 0.5);
      g.lineTo(canvasW, mid + 0.5);
      g.stroke();
      if (!data) return;
      let peak = 1e-6;
      for (let i = 0; i < data.length; i += 4) peak = Math.max(peak, Math.abs(data[i]));
      const { mins, maxs } = computePeaks(data, sr, t0, secPerPx, canvasW);
      const amp = (LANE / 2 - 6) / peak;
      g.fillStyle = color;
      g.globalAlpha = 0.85;
      for (let c = 0; c < canvasW; c++) {
        const top = mid - maxs[c] * amp;
        const bot = mid - mins[c] * amp;
        g.fillRect(c, top, 1, Math.max(1, bot - top));
      }
      g.globalAlpha = 1;
    };

    drawLane(proMono, proBuf?.sampleRate ?? 44100, 0, LANE_PRO_Y, COLORS.pro);
    // User は offset 分シフトして Pro の時間軸に揃える
    drawLane(userMono, userBuf?.sampleRate ?? 44100, offset, LANE_USER_Y, COLORS.user);

    // レーン名（直接ラベル）
    g.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    g.textBaseline = "top";
    const tag = (label: string, y: number, color: string) => {
      const w = g.measureText(label).width + 12;
      g.fillStyle = "rgba(11,15,20,0.85)";
      g.fillRect(6, y + 6, w, 18);
      g.fillStyle = color;
      g.fillRect(6, y + 6, 3, 18);
      g.fillStyle = COLORS.text;
      g.fillText(label, 13, y + 10);
    };

    if (result) {
      const matchedPro = new Set(result.pairs.map((p) => p.proTime));
      // Pro オンセット
      for (const o of result.proOnsets) {
        const x = Math.round(xOf(o.time)) + 0.5;
        g.strokeStyle = COLORS.proBright;
        g.globalAlpha = matchedPro.has(o.time) ? 0.9 : 0.4;
        g.setLineDash(matchedPro.has(o.time) ? [] : [3, 3]);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, LANE_PRO_Y);
        g.lineTo(x, LANE_PRO_Y + LANE);
        g.stroke();
      }
      // User オンセット
      const matchedUser = new Set(result.pairs.map((p) => p.userTime));
      for (const o of result.userOnsets) {
        const x = Math.round(xOf(o.time - offset)) + 0.5;
        g.strokeStyle = COLORS.userBright;
        g.globalAlpha = matchedUser.has(o.time) ? 0.9 : 0.4;
        g.setLineDash(matchedUser.has(o.time) ? [] : [3, 3]);
        g.beginPath();
        g.moveTo(x, LANE_USER_Y);
        g.lineTo(x, LANE_USER_Y + LANE);
        g.stroke();
      }
      g.setLineDash([]);
      g.globalAlpha = 1;

      // 対応線 + ズレ量ラベル（近接時は 2 段に振り分け）
      g.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.textBaseline = "middle";
      let lastX = -Infinity;
      let row = 0;
      for (const p of result.pairs) {
        const xp = xOf(p.proTime);
        const xu = xOf(p.userTime - offset);
        const sev = severityOf(p.devMs);
        const col = SEVERITY_COLOR[sev];
        g.strokeStyle = col;
        g.lineWidth = 1.5;
        g.globalAlpha = 0.9;
        g.beginPath();
        g.moveTo(xp, BAND_Y);
        g.lineTo(xu, BAND_Y + BAND);
        g.stroke();
        g.globalAlpha = 1;

        // ズレが大きい箇所は区間をハイライト
        if (sev !== "good") {
          g.fillStyle = col;
          g.globalAlpha = 0.12;
          const a = Math.min(xp, xu);
          g.fillRect(a, LANE_PRO_Y, Math.max(2, Math.abs(xu - xp)), HEIGHT - LANE_PRO_Y);
          g.globalAlpha = 1;
        }

        const label = fmtMs(p.devMs);
        const tw = g.measureText(label).width + 8;
        const cx = (xp + xu) / 2;
        row = cx - lastX < tw + 2 ? 1 - row : 0;
        lastX = cx;
        const ly = BAND_Y + (row === 0 ? 15 : BAND - 15);
        g.fillStyle = COLORS.surface;
        g.fillRect(cx - tw / 2, ly - 7, tw, 14);
        g.strokeStyle = col;
        g.lineWidth = 1;
        g.strokeRect(cx - tw / 2 + 0.5, ly - 6.5, tw - 1, 13);
        g.fillStyle = COLORS.text;
        g.textAlign = "center";
        g.fillText(label, cx, ly + 0.5);
        g.textAlign = "left";
      }
    }

    g.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    g.textBaseline = "top";
    tag("PRO  お手本", LANE_PRO_Y, COLORS.pro);
    tag("USER  自分", LANE_USER_Y, COLORS.user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proMono, userMono, result, canvasW, secPerPx, duration, offset]);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!result) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let best: NotePair | null = null;
    let bd = 14;
    for (const p of result.pairs) {
      const d = Math.abs(xOf((p.proTime + p.userTime - offset) / 2) - x);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    setHover(best ? { pair: best, x: xOf((best.proTime + best.userTime - offset) / 2) } : null);
  };

  const empty = !proBuf && !userBuf;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4 text-xs text-zinc-400">
        <div className="flex items-center gap-4">
          <LegendSwatch color={COLORS.pro} label="お手本（Pro）" />
          <LegendSwatch color={COLORS.user} label="自分（User）" />
          <span className="hidden items-center gap-3 md:flex">
            <span className="text-zinc-500">ズレ:</span>
            <LegendSwatch color={COLORS.good} label="±10ms以内" line />
            <LegendSwatch color={COLORS.warning} label="±25ms以内" line />
            <LegendSwatch color={COLORS.critical} label="25ms超" line />
          </span>
        </div>
        <label className="flex items-center gap-2">
          <span>ズーム</span>
          <input
            type="range"
            min={1}
            max={12}
            step={0.5}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-28 accent-emerald-500"
          />
          <span className="w-8 font-mono tabular-nums">{zoom.toFixed(1)}x</span>
        </label>
      </div>
      <div ref={wrapRef} className="relative overflow-x-auto rounded-lg border border-zinc-800 bg-[#0b0f14]">
        <div className="relative" style={{ width: canvasW, height: HEIGHT }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <canvas ref={canvasRef} className="block" />
          {playhead !== null && (
            <div
              className="pointer-events-none absolute top-0 h-full w-px bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.6)]"
              style={{ left: xOf(playhead) }}
            />
          )}
          {hover && (
            <>
              <div className="pointer-events-none absolute top-0 h-full w-px bg-white/30" style={{ left: hover.x }} />
              <div
                className="pointer-events-none absolute z-10 w-44 rounded-md border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-xs shadow-xl"
                style={{ left: Math.min(Math.max(hover.x + 10, 4), canvasW - 184), top: BAND_Y - 4 }}
              >
                <div className="mb-1 font-semibold text-zinc-100">
                  #{hover.pair.index + 1}　{hover.pair.bar}小節 {hover.pair.beat}拍{hover.pair.offbeat ? "裏" : ""}
                </div>
                <Row k="ズレ" v={fmtMs(hover.pair.devMs)} color={SEVERITY_COLOR[severityOf(hover.pair.devMs)]} />
                <Row k="Pro" v={`${hover.pair.proTime.toFixed(3)}s`} />
                <Row k="User" v={`${(hover.pair.userTime - offset).toFixed(3)}s`} />
                <Row k="判定" v={hover.pair.devMs < -5 ? "前ノリ（早い）" : hover.pair.devMs > 5 ? "後ノリ（遅い）" : "ジャスト"} />
              </div>
            </>
          )}
          {empty && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
              音源を読み込むと波形とオンセットが表示されます
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="flex justify-between gap-2 text-zinc-400">
      <span>{k}</span>
      <span className="flex items-center gap-1 font-mono text-zinc-100">
        {color && <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />}
        {v}
      </span>
    </div>
  );
}

function LegendSwatch({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={line ? "inline-block h-0.5 w-3" : "inline-block h-2.5 w-2.5 rounded-sm"} style={{ background: color }} />
      {label}
    </span>
  );
}
