"use client";

import { useEffect, useMemo, useRef } from "react";
import { playSegment } from "@/lib/audio";
import { describeDiff, fineEnvelope, toMono, type GrooveResult, type Onset } from "@/lib/groove";
import { FEATURE_LABEL, INSTRUMENTS, type FeatureId } from "@/lib/profiles";
import { COLORS, SEVERITY_COLOR, SEVERITY_TEXT, fmtMs } from "@/lib/theme";
import { PanelTitle } from "./Insights";

type Env = { fine: Float32Array; BLK: number; sr: number; norm: number };

function useEnvelope(buf: AudioBuffer | null, winMs: number, onsets: Onset[] | undefined): Env | null {
  return useMemo(() => {
    if (!buf) return null;
    const { fine, BLK } = fineEnvelope(toMono(buf), buf.sampleRate, winMs);
    let g = 1e-9;
    for (let i = 0; i < fine.length; i++) g = Math.max(g, fine[i]);
    const peaks = (onsets ?? []).map((o) => o.peak).sort((a, b) => a - b);
    const med = peaks.length ? peaks[peaks.length >> 1] : 1;
    return { fine, BLK, sr: buf.sampleRate, norm: g * med };
  }, [buf, winMs, onsets]);
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (f: number) => {
  const m = Math.round(69 + 12 * Math.log2(f / 440));
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
};

function valueOf(f: FeatureId, o: Onset, gridDev: number, norm: number): string {
  switch (f) {
    case "timing":
      return `${fmtMs(gridDev)}`;
    case "velocity":
      return `${(20 * Math.log10(Math.max(1e-6, o.peak / norm))).toFixed(1)}dB`;
    case "attack":
      return `${o.attackMs.toFixed(1)}ms`;
    case "length":
      return `${Math.round(o.lengthMs)}ms`;
    case "pitch":
      return o.f0 ? `${o.f0.toFixed(1)}Hz (${noteName(o.f0)})` : "–";
  }
}

export default function NoteDetail({
  result,
  selected,
  proBuf,
  userBuf,
}: {
  result: GrooveResult | null;
  selected: number | null;
  proBuf: AudioBuffer | null;
  userBuf: AudioBuffer | null;
}) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const inst = result ? INSTRUMENTS[result.instrument] : null;
  const winMs = inst?.detect.envWinMs ?? 5;
  const proEnv = useEnvelope(proBuf, winMs, result?.proOnsets);
  const userEnv = useEnvelope(userBuf, winMs, result?.userOnsets);
  const pair = result && selected !== null ? result.pairs[selected] : null;
  const offset = result?.offsetSec ?? 0;

  const proMed = useMemo(() => {
    const a = (result?.proOnsets ?? []).map((o) => o.peak).sort((x, y) => x - y);
    return a.length ? a[a.length >> 1] : 1;
  }, [result]);
  const userMed = useMemo(() => {
    const a = (result?.userOnsets ?? []).map((o) => o.peak).sort((x, y) => x - y);
    return a.length ? a[a.length >> 1] : 1;
  }, [result]);

  const view = useMemo(() => {
    if (!pair) return null;
    const pre = 0.04;
    const span = Math.min(1.2, Math.max(0.18, Math.max(pair.pro.lengthMs, pair.user.lengthMs) / 1000 + 0.08));
    return { t0: pair.proTime - pre, t1: pair.proTime - pre + span + pre };
  }, [pair]);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const W = cv.parentElement?.clientWidth ?? 600;
    const H = 210;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = COLORS.surface;
    g.fillRect(0, 0, W, H);
    if (!pair || !view || !proEnv || !userEnv) return;

    const padL = 8;
    const padT = 16;
    const padB = 22;
    const x = (t: number) => padL + ((t - view.t0) / (view.t1 - view.t0)) * (W - padL * 2);
    const sample = (env: Env, t: number) => {
      const b = Math.round((t * env.sr) / env.BLK);
      return b >= 0 && b < env.fine.length ? env.fine[b] / env.norm : 0;
    };
    let yMax = 1.3;
    for (let px = 0; px < W; px += 2) {
      const t = view.t0 + ((px - padL) / (W - padL * 2)) * (view.t1 - view.t0);
      yMax = Math.max(yMax, sample(proEnv, t), sample(userEnv, t + offset));
    }
    const y = (v: number) => H - padB - (v / (yMax * 1.08)) * (H - padT - padB);

    // 時間グリッド（10ms ごと）
    g.font = "9px ui-monospace, monospace";
    g.fillStyle = COLORS.textMuted;
    const stepMs = view.t1 - view.t0 > 0.5 ? 100 : 20;
    for (let ms = 0; ms <= (view.t1 - view.t0) * 1000; ms += stepMs) {
      const t = pair.proTime + ms / 1000;
      if (t > view.t1) break;
      const xx = Math.round(x(t)) + 0.5;
      g.strokeStyle = COLORS.grid;
      g.beginPath();
      g.moveTo(xx, padT);
      g.lineTo(xx, H - padB);
      g.stroke();
      g.fillText(`${ms}ms`, xx + 2, H - 8);
    }

    const drawEnv = (env: Env, shift: number, color: string, fill: string) => {
      g.beginPath();
      g.moveTo(x(view.t0), y(0));
      for (let px = padL; px <= W - padL; px++) {
        const t = view.t0 + ((px - padL) / (W - padL * 2)) * (view.t1 - view.t0);
        g.lineTo(px, y(sample(env, t + shift)));
      }
      g.lineTo(W - padL, y(0));
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.stroke();
    };
    drawEnv(proEnv, 0, COLORS.proBright, "rgba(8,145,178,0.18)");
    drawEnv(userEnv, offset, COLORS.userBright, "rgba(168,85,247,0.16)");

    const marker = (t: number, color: string, label: string, row: number, dash = false) => {
      const xx = Math.round(x(t)) + 0.5;
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.setLineDash(dash ? [4, 3] : []);
      g.beginPath();
      g.moveTo(xx, padT);
      g.lineTo(xx, H - padB);
      g.stroke();
      g.setLineDash([]);
      g.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      const tw = g.measureText(label).width + 8;
      const lx = Math.min(W - tw - 2, xx + 3);
      g.fillStyle = "rgba(11,15,20,0.85)";
      g.fillRect(lx, padT + row * 16 - 2, tw, 14);
      g.fillStyle = color;
      g.fillText(label, lx + 4, padT + row * 16 + 8);
    };
    const pOn = pair.proTime;
    const uOn = pair.userTime - offset;
    marker(pOn, COLORS.proBright, "先生 発音", 0);
    marker(uOn, COLORS.userBright, `あなた ${fmtMs(pair.devMs)}`, 1);
    if (pOn + pair.pro.lengthMs / 1000 < view.t1) marker(pOn + pair.pro.lengthMs / 1000, COLORS.proBright, "先生 減衰", 2, true);
    if (uOn + pair.user.lengthMs / 1000 < view.t1) marker(uOn + pair.user.lengthMs / 1000, COLORS.userBright, "あなた 減衰", 3, true);
  }, [pair, view, proEnv, userEnv, offset]);

  const playA = () => proBuf && pair && playSegment(proBuf, pair.proTime - 0.05, 0.7);
  const playB = () => userBuf && pair && playSegment(userBuf, pair.userTime - 0.05, 0.7);
  const playAB = () => {
    if (!proBuf || !userBuf || !pair) return;
    playSegment(proBuf, pair.proTime - 0.05, 0.7);
    playSegment(userBuf, pair.userTime - 0.05, 0.7, 0.9);
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-[#11161d] p-4">
      <PanelTitle
        right={
          pair && (
            <div className="flex gap-1 text-[11px]">
              <button type="button" onClick={playA} className="rounded border border-cyan-700/60 px-2 py-0.5 text-cyan-200 hover:bg-cyan-500/10">▶ 先生</button>
              <button type="button" onClick={playB} className="rounded border border-violet-700/60 px-2 py-0.5 text-violet-200 hover:bg-violet-500/10">▶ あなた</button>
              <button type="button" onClick={playAB} className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-200 hover:bg-zinc-800">▶ 交互に聴く</button>
            </div>
          )
        }
      >
        {pair ? `ノート詳細 #${pair.index + 1}　${pair.posLabel}` : "ノート詳細"}
      </PanelTitle>
      <div className="w-full">
        <canvas ref={cvRef} className="block rounded-md" />
      </div>
      {!pair ? (
        <p className="mt-2 text-xs text-zinc-500">波形・ニュアンスマップ・惜しいポイントから音を選ぶと、音の形（立ち上がりと減衰）を重ねて比較できます</p>
      ) : (
        inst && (
          <table className="mt-3 w-full text-xs">
            <thead className="text-[10px] text-zinc-500">
              <tr>
                <th className="py-1 text-left font-medium">観点</th>
                <th className="py-1 text-right font-medium">先生</th>
                <th className="py-1 text-right font-medium">あなた</th>
                <th className="py-1 pl-3 text-left font-medium">差</th>
                <th className="py-1 text-right font-medium">判定</th>
              </tr>
            </thead>
            <tbody className="font-mono text-zinc-300">
              {inst.features.map((f) => {
                const d = pair.diff[f];
                const sev = pair.sev[f];
                return (
                  <tr key={f} className="border-t border-zinc-800/70">
                    <td className="py-1.5 font-sans text-zinc-200">
                      {FEATURE_LABEL[f]}
                      {f === "timing" && <span className="ml-1 text-[9px] text-zinc-500">(メトロノーム比)</span>}
                    </td>
                    <td className="py-1.5 text-right">{valueOf(f, pair.pro, pair.gridDevProMs, proMed)}</td>
                    <td className="py-1.5 text-right">{valueOf(f, pair.user, pair.gridDevUserMs, userMed)}</td>
                    <td className="py-1.5 pl-3 font-sans">{d === undefined ? "–" : f === "timing" && pair.anchor ? "基準の音" : describeDiff(f, d, pair.pro)}</td>
                    <td className="py-1.5 text-right font-sans">
                      {sev ? (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: SEVERITY_COLOR[sev], background: `${SEVERITY_COLOR[sev]}1c` }}>
                          {SEVERITY_TEXT[sev]}
                        </span>
                      ) : (
                        "–"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
