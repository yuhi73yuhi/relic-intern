/**
 * GrooveLens 解析エンジン
 * AudioBuffer → オンセット検出（＋アタック・音の長さ・強さ・ピッチ）→ 先生の演奏と対応付け
 * → ニュアンスごとのズレ → スコア / 惜しいポイント / 総評
 */
import {
  FEATURE_LABEL,
  GENRES,
  INSTRUMENTS,
  subLabel,
  type FeatureId,
  type Genre,
  type GenreId,
  type Instrument,
  type InstrumentId,
} from "./profiles";

export type Onset = {
  time: number;
  /** トラック内で正規化したピーク振幅 */
  peak: number;
  /** 立ち上がり時間（ピークの20%→90%, ms） */
  attackMs: number;
  /** 音の長さ（立ち上がりから -16dB に減衰するまで, ms） */
  lengthMs: number;
  /** 基本周波数（ボーカルのみ） */
  f0: number | null;
};

export type Severity = "good" | "warning" | "critical";

export type NotePair = {
  index: number;
  proTime: number;
  userTime: number; // アライメント適用前の元の時刻
  devMs: number; // 先生比のタイミング差（+ = 遅い / - = 早い）
  gridDevProMs: number; // メトロノーム（グリッド）に対する先生のズレ
  gridDevUserMs: number; // メトロノームに対する自分のズレ
  bar: number;
  beat: number;
  sub: number;
  posLabel: string;
  pro: Onset;
  user: Onset;
  /** 各ニュアンスの差（自分 − 先生）。単位は FEATURE_UNIT */
  diff: Partial<Record<FeatureId, number>>;
  /** 判定の物差しで割った正規化誤差（符号つき） */
  err: Partial<Record<FeatureId, number>>;
  sev: Partial<Record<FeatureId, Severity>>;
  anchor: boolean;
};

export type Issue = {
  id: string;
  feature: FeatureId | "missing";
  title: string;
  detail: string;
  tip: string;
  noteIdx: number[];
  gain: number; // 直したときのスコア上昇（点）
  severity: Severity;
};

export type Summary = { level: Severity | "info"; title: string; body: string };

export type GrooveResult = {
  instrument: InstrumentId;
  genre: GenreId;
  pairs: NotePair[];
  missed: Onset[];
  extra: Onset[];
  proOnsets: Onset[];
  userOnsets: Onset[];
  offsetSec: number;
  bpm: number;
  meanMs: number;
  stdMs: number;
  gridMeanProMs: number;
  gridMeanUserMs: number;
  tendency: "rush" | "drag" | "stable";
  score: number;
  sub: Partial<Record<FeatureId, number>>;
  completeness: number;
  issues: Issue[];
  summary: Summary[];
  swing: { pro: number; user: number } | null;
  dynRange: { pro: number; user: number };
};

export type AlignMode = "none" | "first";

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

export function toMono(buf: AudioBuffer): Float32Array {
  const n = buf.length;
  const out = new Float32Array(n);
  const chs = buf.numberOfChannels;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i] / chs;
  }
  return out;
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const db = (x: number) => 20 * Math.log10(Math.max(1e-6, x));

// ---------------------------------------------------------------------------
// 1. オンセット検出 + ニュアンス特徴量
// ---------------------------------------------------------------------------

/** 振幅包絡（16 サンプル単位の max|x| → 因果的スライディング max） */
export function fineEnvelope(x: Float32Array, sr: number, winMs: number) {
  const BLK = 16;
  const nb = Math.ceil(x.length / BLK);
  const blk = new Float32Array(nb);
  for (let b = 0; b < nb; b++) {
    let m = 0;
    const end = Math.min(x.length, (b + 1) * BLK);
    for (let i = b * BLK; i < end; i++) {
      const a = Math.abs(x[i]);
      if (a > m) m = a;
    }
    blk[b] = m;
  }
  const W = Math.max(1, Math.round((winMs / 1000) * sr / BLK));
  const fine = new Float32Array(nb);
  // 単調デックで O(n) のスライディング max
  const dq = new Int32Array(nb);
  let h = 0;
  let t = 0;
  for (let b = 0; b < nb; b++) {
    while (t > h && blk[dq[t - 1]] <= blk[b]) t--;
    dq[t++] = b;
    if (dq[h] <= b - W) h++;
    fine[b] = blk[dq[h]];
  }
  return { fine, BLK };
}

/** YIN による基本周波数推定 */
function yinF0(x: Float32Array, sr: number, start: number, end: number): number | null {
  const N = 2048;
  const tauMin = Math.floor(sr / 1000);
  const tauMax = Math.floor(sr / 70);
  const ests: number[] = [];
  for (let s = start; s + N + tauMax < Math.min(end, x.length) && ests.length < 4; s += 1024) {
    const d = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        const v = x[s + i] - x[s + i + tau];
        sum += v * v;
      }
      d[tau] = sum;
    }
    let run = 0;
    let found = -1;
    for (let tau = 1; tau <= tauMax; tau++) {
      run += d[tau];
      const cm = run > 0 ? (d[tau] * tau) / run : 1;
      if (tau >= tauMin && cm < 0.15) {
        let tt = tau;
        while (tt + 1 <= tauMax && d[tt + 1] < d[tt]) tt++;
        found = tt;
        break;
      }
    }
    if (found > 0 && found < tauMax) {
      const a = d[found - 1];
      const b = d[found];
      const c = d[found + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
      ests.push(sr / (found + shift));
    }
  }
  return ests.length ? median(ests) : null;
}

export function detectOnsets(buf: AudioBuffer, inst: Instrument): Onset[] {
  const p = inst.detect;
  const sr = buf.sampleRate;
  const x = toMono(buf);
  const hopS = 0.0025;
  const hop = Math.round(sr * hopS);
  const win = Math.round(sr * Math.max(0.01, p.envWinMs / 1000));
  const frames = Math.max(0, Math.floor((x.length - win) / hop) + 1);
  if (frames < 8) return [];
  // 2 つの帯域で振幅エンベロープを取る: 全帯域 + 1 次差分（高域・アタックの「カチッ」を強調）
  const rmsEnv = (sig: Float32Array) => {
    const e = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let s = 0;
      const o = f * hop;
      for (let i = 0; i < win; i++) s += sig[o + i] * sig[o + i];
      e[f] = Math.sqrt(s / win);
    }
    return e;
  };
  const dx = new Float32Array(x.length);
  for (let i = 1; i < x.length; i++) dx[i] = x[i] - x[i - 1];
  const LAG = Math.max(1, Math.round(p.lagMs / 1000 / hopS));
  const bands = [rmsEnv(x), rmsEnv(dx)].map((env) => {
    let mx = 1e-9;
    for (let i = 0; i < frames; i++) mx = Math.max(mx, env[i]);
    const lev = new Float32Array(frames);
    for (let i = 0; i < frames; i++) lev[i] = Math.max(-50, db(env[i] / mx));
    const odf = new Float32Array(frames);
    for (let i = LAG; i < frames; i++) odf[i] = Math.max(0, lev[i] - lev[i - LAG]);
    return { lev, odf, mx };
  });
  if (bands[0].mx < 1e-5) return [];
  const lev = bands[0].lev;
  const odf = new Float32Array(frames);
  for (let i = 0; i < frames; i++) odf[i] = Math.max(bands[0].odf[i], bands[1].odf[i]);

  const minGap = Math.round(p.minGapMs / 1000 / hopS);
  const localWin = Math.round(0.2 / hopS);
  const cands: number[] = [];
  let last = -Infinity;
  for (let i = 1; i < frames - 1; i++) {
    if (odf[i] < p.riseDb || odf[i] < odf[i - 1] || odf[i] < odf[i + 1]) continue;
    const ahead = Math.min(frames - 1, i + LAG);
    if (lev[ahead] < -34 && bands[1].lev[ahead] < -34) continue;
    const local: number[] = [];
    for (let k = Math.max(0, i - localWin); k < Math.min(frames, i + localWin); k += 2) local.push(odf[k]);
    if (odf[i] < median(local) + p.riseDb) continue;
    if (i - last < minGap) {
      if (cands.length && odf[i] > odf[cands[cands.length - 1]]) {
        cands[cands.length - 1] = i;
        last = i;
      }
      continue;
    }
    cands.push(i);
    last = i;
  }

  const { fine, BLK } = fineEnvelope(x, sr, p.envWinMs);
  const nb = fine.length;
  let gPeak = 1e-9;
  for (let b = 0; b < nb; b++) gPeak = Math.max(gPeak, fine[b]);
  const toB = (sec: number) => Math.round((sec * sr) / BLK);

  type Raw = { b: number; pIdx: number; P: number; a90: number };
  const raws: Raw[] = [];
  for (let ci = 0; ci < cands.length; ci++) {
    const c = cands[ci];
    // 候補フレーム c の RMS 窓は [c*hop, c*hop+win]。立ち上がりはこの窓の終わりより前にある
    const endB = Math.min(nb - 1, Math.round((c * hop + win) / BLK));
    const prevEnd = raws.length ? raws[raws.length - 1].pIdx + 1 : 0;
    const from = Math.max(prevEnd, Math.round(((c - LAG) * hop) / BLK) - toB(0.03));
    const nextStart = ci + 1 < cands.length ? Math.round(((cands[ci + 1] - LAG) * hop) / BLK) : nb - 1;
    const to = Math.min(nb - 1, endB + toB(p.attackWinMs / 1000), Math.max(endB, nextStart));
    if (endB <= from) continue;
    // 1) 谷（前の音の余韻との境目）= 窓内の最小点
    let v = from;
    for (let k = from; k <= endB; k++) if (fine[k] < fine[v]) v = k;
    // 2) 谷より後ろのピーク
    let pIdx = v;
    for (let k = v; k <= to; k++) if (fine[k] > fine[pIdx]) pIdx = k;
    const P = fine[pIdx];
    const V = fine[v];
    if (P <= V * 1.2) continue;
    // 3) 谷→ピークの 20% を超えた点を立ち上がりとする
    const thr = V + (P - V) * 0.2;
    let b = v;
    while (b < pIdx && fine[b] < thr) b++;
    let a90 = b;
    while (a90 < pIdx && fine[a90] < V + (P - V) * 0.9) a90++;
    if (raws.length && (b - raws[raws.length - 1].b) * BLK < sr * 0.035) continue;
    raws.push({ b, pIdx, P, a90 });
  }

  return raws.map((r, k) => {
    const limit = k + 1 < raws.length ? raws[k + 1].b : Math.min(nb - 1, r.b + toB(3));
    let e = r.pIdx;
    while (e < limit && fine[e] >= r.P * 0.16) e++;
    // 立ち上がりを直線とみなし、20%→90% の傾きから発音の開始点を外挿する（アタックの遅さがタイミングに混ざらないように）
    const time = Math.max(0, ((r.b - (r.a90 - r.b) * (0.2 / 0.7)) * BLK) / sr);
    const lengthMs = ((e - r.b) * BLK * 1000) / sr;
    let f0: number | null = null;
    if (inst.features.includes("pitch")) {
      const s = Math.round((r.b * BLK) + (e - r.b) * BLK * 0.3);
      const en = Math.round(r.b * BLK + (e - r.b) * BLK * 0.85);
      f0 = yinF0(x, sr, s, en);
    }
    return {
      time,
      peak: r.P / gPeak,
      attackMs: ((r.a90 - r.b) * BLK * 1000) / sr,
      lengthMs,
      f0,
    };
  });
}

// ---------------------------------------------------------------------------
// 2. テンポ・グリッド推定と対応付け
// ---------------------------------------------------------------------------

/** ジャンルの基準テンポ周辺で、オンセットが最もよく乗るグリッドを探す */
function fitGrid(times: number[], genre: Genre) {
  const t0 = times[0] ?? 0;
  let best = { bpm: genre.bpm, score: -1 };
  for (let bpm = genre.bpm * 0.72; bpm <= genre.bpm * 1.38; bpm += 0.25) {
    const step = 60 / bpm / genre.div;
    let sc = 0;
    for (const t of times) {
      const r = (t - t0) / step;
      const d = (r - Math.round(r)) * step;
      sc += Math.exp(-(d * d) / (2 * 0.012 * 0.012));
    }
    if (sc > best.score + 1e-9) best = { bpm, score: sc };
  }
  // 線形回帰で位相とテンポを微調整
  const step0 = 60 / best.bpm / genre.div;
  const slots = times.map((t) => Math.round((t - t0) / step0));
  const n = times.length;
  if (n >= 3) {
    const ms = mean(slots);
    const mt = mean(times);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (slots[i] - ms) * (times[i] - mt);
      den += (slots[i] - ms) ** 2;
    }
    const step = den > 0 ? num / den : step0;
    const a = mt - step * ms;
    return { step, origin: a, bpm: 60 / (step * genre.div) };
  }
  return { step: step0, origin: t0, bpm: best.bpm };
}

function alignOnsets(pro: number[], user: number[], tol: number) {
  const n = pro.length;
  const m = user.length;
  const INF = 1e9;
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
  const from = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  cost[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const c = cost[i][j];
      if (c >= INF) continue;
      if (i < n && j < m) {
        const d = Math.abs(pro[i] - user[j]);
        if (d <= tol && c + d < cost[i + 1][j + 1]) {
          cost[i + 1][j + 1] = c + d;
          from[i + 1][j + 1] = 0;
        }
      }
      if (i < n && c + tol < cost[i + 1][j]) {
        cost[i + 1][j] = c + tol;
        from[i + 1][j] = 1;
      }
      if (j < m && c + tol < cost[i][j + 1]) {
        cost[i][j + 1] = c + tol;
        from[i][j + 1] = 2;
      }
    }
  }
  const matches: [number, number][] = [];
  const missed: number[] = [];
  const extra: number[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const f = from[i][j];
    if (i > 0 && j > 0 && f === 0) {
      matches.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (i > 0 && (f === 1 || j === 0)) {
      missed.push(i - 1);
      i--;
    } else {
      extra.push(j - 1);
      j--;
    }
  }
  return { matches: matches.reverse(), missed: missed.reverse(), extra: extra.reverse() };
}

// ---------------------------------------------------------------------------
// 3. ニュアンスの差・判定
// ---------------------------------------------------------------------------

function normErr(f: FeatureId, pro: Onset, user: Onset, diff: number, genre: Genre): number {
  switch (f) {
    case "timing":
      return diff / (genre.tightMs * 2.5);
    case "velocity":
      return diff / 6;
    case "attack":
      return Math.log2((user.attackMs + 3) / (pro.attackMs + 3)) / 1.0;
    case "length":
      return Math.log2((user.lengthMs + 20) / (pro.lengthMs + 20)) / 0.6;
    case "pitch":
      return diff / 25;
  }
}

export const sevOf = (e: number): Severity => (Math.abs(e) <= 0.45 ? "good" : Math.abs(e) <= 1 ? "warning" : "critical");

/** スコア計算（override で「直した」と仮定するノート × ニュアンスを指定） */
function computeScore(
  pairs: NotePair[],
  inst: Instrument,
  total: number,
  zero?: (i: number, f: FeatureId) => boolean,
  extraMatched = 0,
) {
  const sub: Partial<Record<FeatureId, number>> = {};
  let wsum = 0;
  let acc = 0;
  for (const f of inst.features) {
    const vals: number[] = [];
    pairs.forEach((p, i) => {
      if (f === "timing" && p.anchor) return;
      const e = p.err[f];
      if (e === undefined) return;
      vals.push(zero?.(i, f) ? 1 : Math.exp(-(e * e)));
    });
    for (let k = 0; k < extraMatched; k++) vals.push(1);
    if (!vals.length) continue;
    const s = mean(vals);
    sub[f] = s * 100;
    const w = inst.weights[f] ?? 0;
    wsum += w;
    acc += w * s;
  }
  const completeness = total ? Math.min(1, (pairs.length + extraMatched) / total) : 0;
  const score = wsum ? (100 * acc * completeness) / wsum : 0;
  return { score, sub, completeness: completeness * 100 };
}

const fmtSigned = (v: number, d = 0) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;

export function describeDiff(f: FeatureId, diff: number, pro?: Onset): string {
  switch (f) {
    case "timing":
      return `${fmtSigned(diff)}ms ${diff < 0 ? "早い" : "遅い"}`;
    case "velocity":
      return `${fmtSigned(diff, 1)}dB ${diff > 0 ? "強い" : "弱い"}`;
    case "attack":
      return `${fmtSigned(diff, 1)}ms ${diff > 0 ? "立ち上がりが遅い" : "立ち上がりが鋭い"}`;
    case "length": {
      const pct = pro && pro.lengthMs > 0 ? (diff / pro.lengthMs) * 100 : 0;
      return `${fmtSigned(pct)}% ${diff < 0 ? "短い" : "長い"}`;
    }
    case "pitch":
      return `${fmtSigned(diff)}cent ${diff < 0 ? "低い" : "高い"}`;
  }
}

// ---------------------------------------------------------------------------
// 4. メイン解析
// ---------------------------------------------------------------------------

export function analyzeGroove(
  proBuf: AudioBuffer,
  userBuf: AudioBuffer,
  instrumentId: InstrumentId,
  genreId: GenreId,
  align: AlignMode,
): GrooveResult {
  const inst = INSTRUMENTS[instrumentId];
  const genre = GENRES[genreId];
  const proOnsets = detectOnsets(proBuf, inst);
  const userOnsets = detectOnsets(userBuf, inst);
  const proT = proOnsets.map((o) => o.time);
  const rawUserT = userOnsets.map((o) => o.time);
  const offsetSec = align === "first" && proT.length && rawUserT.length ? rawUserT[0] - proT[0] : 0;
  const userT = rawUserT.map((t) => t - offsetSec);

  const grid = fitGrid(proT, genre);
  const beatSec = grid.step * genre.div;
  const tol = clamp(grid.step * 0.45, 0.025, 0.2);
  const { matches, missed, extra } = alignOnsets(proT, userT, tol);

  const proMed = median(proOnsets.map((o) => o.peak)) || 1;
  const userMed = median(userOnsets.map((o) => o.peak)) || 1;

  const pairs: NotePair[] = matches.map(([pi, ui], k) => {
    const pro = proOnsets[pi];
    const user = userOnsets[ui];
    const slot = Math.round((proT[pi] - grid.origin) / grid.step);
    const gridT = grid.origin + slot * grid.step;
    const perBar = genre.div * 4;
    const s0 = ((slot % perBar) + perBar) % perBar;
    const bar = Math.floor(slot / perBar) + 1;
    const beat = Math.floor(s0 / genre.div) + 1;
    const sub = s0 % genre.div;
    const devMs = (userT[ui] - proT[pi]) * 1000;
    const diff: Partial<Record<FeatureId, number>> = {
      timing: devMs,
      velocity: db(user.peak / userMed) - db(pro.peak / proMed),
      attack: user.attackMs - pro.attackMs,
      length: user.lengthMs - pro.lengthMs,
    };
    if (inst.features.includes("pitch") && pro.f0 && user.f0) diff.pitch = 1200 * Math.log2(user.f0 / pro.f0);
    const err: Partial<Record<FeatureId, number>> = {};
    const sev: Partial<Record<FeatureId, Severity>> = {};
    for (const f of inst.features) {
      const d = diff[f];
      if (d === undefined) continue;
      err[f] = normErr(f, pro, user, d, genre);
      sev[f] = sevOf(err[f]!);
    }
    return {
      index: k,
      proTime: proT[pi],
      userTime: rawUserT[ui],
      devMs,
      gridDevProMs: (proT[pi] - gridT) * 1000,
      gridDevUserMs: (userT[ui] - gridT) * 1000,
      bar,
      beat,
      sub,
      posLabel: `${bar}小節 ${beat}拍目${subLabel(genre.div, sub)}`,
      pro,
      user,
      diff,
      err,
      sev,
      anchor: false,
    };
  });
  if (align === "first" && pairs.length > 1 && Math.abs(pairs[0].devMs) < 1e-3) {
    pairs[0].anchor = true;
    delete pairs[0].sev.timing;
  }

  const total = Math.max(proOnsets.length, userOnsets.length);
  const base = computeScore(pairs, inst, total);
  const timed = pairs.filter((p) => !p.anchor);
  const devs = timed.map((p) => p.devMs);
  const meanMs = mean(devs);
  const stdMs = std(devs);
  const tendency = meanMs <= -8 ? "rush" : meanMs >= 8 ? "drag" : "stable";

  // スウィング比（3連グリッドの 3 つ目にある音）
  let swing: GrooveResult["swing"] = null;
  if (genre.div === 3) {
    const sw = pairs.filter((p) => p.sub === 2);
    if (sw.length >= 2) {
      const ratio = (t: number) => {
        const slot = Math.round((t - grid.origin) / grid.step);
        const beatStart = grid.origin + (slot - 2) * grid.step;
        return ((t - beatStart) / beatSec) * 100;
      };
      swing = { pro: mean(sw.map((p) => ratio(p.proTime))), user: mean(sw.map((p) => ratio(p.userTime - offsetSec))) };
    }
  }

  const vp = pairs.map((p) => db(p.pro.peak / proMed));
  const vu = pairs.map((p) => db(p.user.peak / userMed));
  const range = (a: number[]) => {
    if (a.length < 3) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length * 0.9)] - s[Math.floor(s.length * 0.1)];
  };
  const dynRange = { pro: range(vp), user: range(vu) };

  const result: GrooveResult = {
    instrument: instrumentId,
    genre: genreId,
    pairs,
    missed: missed.map((i) => proOnsets[i]),
    extra: extra.map((j) => userOnsets[j]),
    proOnsets,
    userOnsets,
    offsetSec,
    bpm: grid.bpm,
    meanMs,
    stdMs,
    gridMeanProMs: mean(timed.map((p) => p.gridDevProMs)),
    gridMeanUserMs: mean(timed.map((p) => p.gridDevUserMs)),
    tendency,
    score: Math.round(clamp(base.score, 0, 100)),
    sub: base.sub,
    completeness: base.completeness,
    issues: [],
    summary: [],
    swing,
    dynRange,
  };
  result.issues = findIssues(result, inst, genre, total, base.score);
  result.summary = buildSummary(result, inst, genre);
  return result;
}

// ---------------------------------------------------------------------------
// 5. 惜しいポイント（直すと何点上がるか）
// ---------------------------------------------------------------------------

function findIssues(r: GrooveResult, inst: Instrument, genre: Genre, total: number, baseScore: number): Issue[] {
  const issues: Omit<Issue, "gain">[] = [];
  const covered = new Set<string>();

  // メトロノーム基準なら「OK」なのに、先生基準ではズレている場合に注記する
  const metronomeNote = (f: FeatureId, idx: number[]) => {
    if (f !== "timing") return "";
    const g = mean(idx.map((i) => r.pairs[i].gridDevUserMs));
    return Math.abs(g) <= genre.tightMs * 1.1
      ? ` ／ メトロノーム基準では ${fmtSigned(g)}ms で、一般的なリズム判定では「OK」になるズレです`
      : "";
  };

  for (const f of inst.features) {
    // 拍内の位置ごとにまとめ、毎回同じ方向にズレている「癖」を探す
    const groups = new Map<string, number[]>();
    r.pairs.forEach((p, i) => {
      if (p.err[f] === undefined || (f === "timing" && p.anchor)) return;
      const key = `${p.beat}-${p.sub}`;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    });
    const byKey = { plus: [] as string[], minus: [] as string[] };
    for (const [key, idx] of groups) {
      if (idx.length < 2) continue;
      const es = idx.map((i) => r.pairs[i].err[f]!);
      const m = mean(es);
      const consistent = es.filter((e) => Math.sign(e) === Math.sign(m) && Math.abs(e) > 0.3).length / es.length;
      if (Math.abs(m) > 0.45 && consistent >= 0.6) byKey[m > 0 ? "plus" : "minus"].push(key);
    }
    for (const sign of ["minus", "plus"] as const) {
      const keys = byKey[sign].sort();
      if (!keys.length) continue;
      const idx = keys.flatMap((k) => groups.get(k)!);
      idx.forEach((i) => covered.add(`${i}-${f}`));
      const labels = keys.map((k) => {
        const [b, s] = k.split("-").map(Number);
        return `${b}拍目${subLabel(genre.div, s)}`;
      });
      const where = labels.length >= 5 ? "" : labels.length > 3 ? `${labels.slice(0, 3).join("・")} など` : labels.join("・");
      const diffs = idx.map((i) => r.pairs[i].diff[f]!);
      const md = mean(diffs);
      const hit = idx.filter((i) => Math.sign(r.pairs[i].err[f]!) === (sign === "plus" ? 1 : -1)).length;
      const pro0 = r.pairs[idx[0]].pro;
      const avgPro: Onset = { ...pro0, lengthMs: mean(idx.map((i) => r.pairs[i].pro.lengthMs)) };
      const worstE = Math.max(...idx.map((i) => Math.abs(r.pairs[i].err[f]!)));
      issues.push({
        id: `pat-${f}-${sign}`,
        feature: f,
        title: where ? `${where}の${FEATURE_LABEL[f]}` : `全体的な${FEATURE_LABEL[f]}`,
        detail: `平均 ${describeDiff(f, md, avgPro)}（${idx.length}回中${hit}回）${metronomeNote(f, idx)}`,
        tip: inst.tips[f][sign] || "お手本の該当箇所を繰り返し聴き、同じ音になるまで部分練習しましょう",
        noteIdx: idx.sort((a, b) => a - b),
        severity: worstE > 1 && Math.abs(mean(idx.map((i) => r.pairs[i].err[f]!))) > 0.8 ? "critical" : "warning",
      });
    }
  }

  // 単発の大きなズレ
  const singles: { i: number; f: FeatureId; e: number }[] = [];
  r.pairs.forEach((p, i) => {
    for (const f of inst.features) {
      const e = p.err[f];
      if (e === undefined || covered.has(`${i}-${f}`) || (f === "timing" && p.anchor)) continue;
      if (Math.abs(e) > 1) singles.push({ i, f, e });
    }
  });
  singles
    .sort((a, b) => Math.abs(b.e) - Math.abs(a.e))
    .slice(0, 3)
    .forEach(({ i, f, e }) => {
      const p = r.pairs[i];
      issues.push({
        id: `one-${i}-${f}`,
        feature: f,
        title: `${p.posLabel}の${FEATURE_LABEL[f]}`,
        detail: `${describeDiff(f, p.diff[f]!, p.pro)}（この1音だけ）`,
        tip: inst.tips[f][e > 0 ? "plus" : "minus"] || "前後のフレーズを含めて部分練習しましょう",
        noteIdx: [i],
        severity: "critical",
      });
    });

  if (r.missed.length || r.extra.length) {
    issues.push({
      id: "missing",
      feature: "missing",
      title: "音の抜け・余分な音",
      detail: `抜け ${r.missed.length} 音 / 余分 ${r.extra.length} 音`,
      tip: `${inst.noun}の出し損じや、弱い音（ゴーストノート等）が小さすぎて消えていないか、該当小節をゆっくり確認しましょう`,
      noteIdx: [],
      severity: "warning",
    });
  }

  return issues
    .map((iss) => {
      let s: number;
      if (iss.feature === "missing") {
        s = computeScore(r.pairs, inst, total, undefined, r.missed.length).score;
        if (r.extra.length) s = Math.min(100, s + (100 * r.extra.length) / total);
      } else {
        const set = new Set(iss.noteIdx);
        s = computeScore(r.pairs, inst, total, (i, f) => f === iss.feature && set.has(i)).score;
      }
      return { ...iss, gain: Math.max(0, Math.round(s - baseScore)) };
    })
    .filter((i) => i.gain > 0 || i.feature === "missing")
    .sort((a, b) => b.gain - a.gain);
}

// ---------------------------------------------------------------------------
// 6. 総評
// ---------------------------------------------------------------------------

function buildSummary(r: GrooveResult, inst: Instrument, genre: Genre): Summary[] {
  const out: Summary[] = [];
  if (!r.pairs.length) {
    return [
      {
        level: "critical",
        title: "対応する音が見つかりません",
        body: "オンセットを検出できなかったか、2つの録音の位置・テンポが大きく異なります。録音レベル・開始位置・楽器の選択を確認してください。",
      },
    ];
  }

  const avg = Math.round(Math.abs(r.meanMs));
  const tLabel = r.tendency === "rush" ? "前ノリ（走り気味）" : r.tendency === "drag" ? "後ノリ（もたり気味）" : "ほぼ一致";
  out.push({
    level: r.tendency === "stable" ? "good" : avg >= genre.tightMs * 2 ? "critical" : "warning",
    title: `タイミングの重心: 先生比 ${r.meanMs >= 0 ? "+" : ""}${Math.round(r.meanMs)}ms（${tLabel}）`,
    body:
      `メトロノーム基準では あなた ${fmtSigned(r.gridMeanUserMs)}ms / 先生 ${fmtSigned(r.gridMeanProMs)}ms。` +
      (Math.abs(r.gridMeanProMs) >= 3
        ? `先生は意図的に${r.gridMeanProMs > 0 ? "後ろ" : "前"}に置いており、その「${r.gridMeanProMs > 0 ? "タメ" : "前ノリ"}」との差が ${avg}ms あります。メトロノームだけでは分からないズレです。`
        : `${genre.label}の基準（±${genre.tightMs}ms）で判定しています。`),
  });

  const sd = Math.round(r.stdMs);
  out.push({
    level: r.stdMs <= genre.tightMs ? "good" : r.stdMs <= genre.tightMs * 2 ? "warning" : "critical",
    title: `ズレのばらつき ±${sd}ms`,
    body:
      r.stdMs <= genre.tightMs
        ? "ズレ方が一定で再現性が高い演奏です。"
        : "1音ごとのズレ方が揃っていません。テンポを10〜20落とし、同じズレ方になるまで繰り返しましょう。",
  });

  if (r.dynRange.pro > 0) {
    const ratio = r.dynRange.user / r.dynRange.pro;
    out.push({
      level: ratio >= 0.75 && ratio <= 1.3 ? "good" : "warning",
      title: `強弱の幅: 先生 ${r.dynRange.pro.toFixed(1)}dB / あなた ${r.dynRange.user.toFixed(1)}dB`,
      body:
        ratio < 0.75
          ? `${inst.noun}の強弱差が先生より小さく、平坦に聞こえます。${genre.groove}。`
          : ratio > 1.3
            ? "強弱差が先生より大きすぎます。弱い音が埋もれていないか確認しましょう。"
            : "強弱の付け方は先生とよく似ています。",
    });
  }

  if (r.swing) {
    const d = r.swing.user - r.swing.pro;
    out.push({
      level: Math.abs(d) < 2.5 ? "good" : "warning",
      title: `スウィング比: 先生 ${r.swing.pro.toFixed(0)}% / あなた ${r.swing.user.toFixed(0)}%`,
      body:
        d < -2.5
          ? "ハネ方が浅く、イーブン（ストレート）に近づいています。ウラ拍を3連の3つ目までしっかり待ちましょう。"
          : d > 2.5
            ? "ハネ方が深すぎます（付点8分寄り）。テンポに合わせて少し浅くしましょう。"
            : "ハネ方は先生とほぼ同じです。",
    });
  }
  return out;
}
