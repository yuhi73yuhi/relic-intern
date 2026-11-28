/** 録音品質チェック（スマホ録音で解析に耐えるか） */
import { toMono } from "./groove";

export type Quality = {
  level: "good" | "warning" | "critical";
  peakDb: number;
  noiseDb: number;
  snrDb: number;
  clipped: number; // クリップしたサンプルの割合
  messages: string[];
};

export function checkQuality(buf: AudioBuffer): Quality {
  const x = toMono(buf);
  const sr = buf.sampleRate;
  const win = Math.round(sr * 0.02);
  const rms: number[] = [];
  let peak = 0;
  let clip = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    if (a >= 0.995) clip++;
  }
  for (let o = 0; o + win < x.length; o += win) {
    let s = 0;
    for (let i = 0; i < win; i++) s += x[o + i] * x[o + i];
    rms.push(Math.sqrt(s / win));
  }
  rms.sort((a, b) => a - b);
  const pct = (p: number) => rms[Math.min(rms.length - 1, Math.floor(rms.length * p))] ?? 0;
  const dB = (v: number) => 20 * Math.log10(Math.max(1e-7, v));
  const noiseDb = dB(pct(0.1));
  const sigDb = dB(pct(0.98));
  const snrDb = sigDb - noiseDb;
  const clipped = clip / Math.max(1, x.length);
  const peakDb = dB(peak);

  const messages: string[] = [];
  let level: Quality["level"] = "good";
  if (clipped > 0.0005) {
    level = "critical";
    messages.push("音割れしています。スマホを楽器から離すか、入力レベルを下げてください");
  }
  if (peakDb < -30) {
    level = "critical";
    messages.push("音が小さすぎます。スマホを楽器に近づけてください");
  }
  if (snrDb < 20) {
    level = "critical";
    messages.push("周囲の雑音が大きく、細かいズレを測れません。静かな場所で録音してください");
  } else if (snrDb < 30) {
    if (level === "good") level = "warning";
    messages.push("雑音がやや多めです。エアコン等を止めると精度が上がります");
  }
  if (!messages.length) messages.push("解析に十分な品質です");
  return { level, peakDb, noiseDb, snrDb, clipped, messages };
}
