/**
 * 精度検証: 正解値つきのデモ演奏を「スマホ録音シミュレーション」に通し、
 * 解析結果が正解からどれだけズレるかを測る。
 */
import { analyzeGroove } from "./groove";
import { GENRES, type GenreId, type InstrumentId } from "./profiles";
import { generateDemoSet } from "./synth";

export type AccuracyReport = {
  instrument: InstrumentId;
  genre: GenreId;
  runs: number;
  notes: number;
  detected: number;
  timingMae: number;
  timingP95: number;
  timingMax: number;
  velocityMae: number;
  verdict: "ok" | "marginal" | "ng";
};

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 1;
};

export async function runAccuracyTest(inst: InstrumentId, genre: GenreId, seeds = [101, 202, 303]): Promise<AccuracyReport> {
  const tErr: number[] = [];
  const vErr: number[] = [];
  let notes = 0;
  let detected = 0;
  for (const seed of seeds) {
    const demo = await generateDemoSet(inst, genre, { phone: true, seed });
    const res = analyzeGroove(demo.teacher, demo.student, inst, genre, "first");
    const truth = demo.truth;
    const trueOffset = truth[0].studentTime! - truth[0].teacherTime;
    const tgMed = median(truth.map((t) => t.teacherGain));
    const sgMed = median(truth.filter((t) => t.studentTime !== null).map((t) => t.studentGain));
    const played = truth.filter((t) => t.studentTime !== null);
    notes += played.length;
    const step = 60 / GENRES[genre].bpm / GENRES[genre].div;
    for (const p of res.pairs) {
      // 先生側の時刻が最も近い正解ノートを探す
      let best = -1;
      let bd = Infinity;
      truth.forEach((t, i) => {
        const d = Math.abs(t.teacherTime - p.proTime);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      const t = truth[best];
      if (!t || t.studentTime === null || bd > step * 0.4) continue;
      detected++;
      if (p.anchor) continue;
      const trueDev = (t.studentTime - trueOffset - t.teacherTime) * 1000;
      tErr.push(Math.abs(p.devMs - trueDev));
      const trueVel = 20 * Math.log10(t.studentGain / sgMed) - 20 * Math.log10(t.teacherGain / tgMed);
      if (p.diff.velocity !== undefined) vErr.push(Math.abs(p.diff.velocity - trueVel));
    }
  }
  const sorted = [...tErr].sort((a, b) => a - b);
  const mae = tErr.reduce((a, b) => a + b, 0) / Math.max(1, tErr.length);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const vm = vErr.reduce((a, b) => a + b, 0) / Math.max(1, vErr.length);
  const rate = detected / Math.max(1, notes);
  const verdict = p95 <= 5 && rate >= 0.9 ? "ok" : p95 <= 10 && rate >= 0.75 ? "marginal" : "ng";
  return {
    instrument: inst,
    genre,
    runs: seeds.length,
    notes,
    detected,
    timingMae: mae,
    timingP95: p95,
    timingMax: sorted[sorted.length - 1] ?? 0,
    velocityMae: vm,
    verdict,
  };
}
