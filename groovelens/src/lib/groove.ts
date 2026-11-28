/**
 * GrooveLens 解析エンジン
 * ブラウザ標準の AudioBuffer だけを入力に、オンセット検出 → 対応付け → スコア/アドバイス生成までを行う。
 */

export type Onset = {
  /** 立ち上がり時刻（秒） */
  time: number;
  /** その音のピーク振幅（0..1、トラック内で正規化済み） */
  peak: number;
};

export type NotePair = {
  index: number;
  proTime: number;
  userTime: number; // アライメント適用前の元の時刻
  devMs: number; // + = 後ノリ（遅い） / - = 前ノリ（早い）
  bar: number;
  beat: number; // 1..4
  offbeat: boolean; // 8分の裏拍
  proPeak: number;
  userPeak: number;
};

export type Tendency = "rush" | "drag" | "stable";

export type SubScores = {
  accuracy: number; // タイミング精度
  stability: number; // 安定性（ばらつきの少なさ）
  pocket: number; // ノリの重心一致（平均ズレの小ささ）
  completeness: number; // 音数一致
  dynamics: number; // 強弱の一致
};

export type BeatStat = { beat: number; offbeat: boolean; meanMs: number; count: number };

export type AdviceLevel = "good" | "warning" | "critical" | "info";
export type Advice = { level: AdviceLevel; title: string; body: string };

export type GrooveResult = {
  pairs: NotePair[];
  missed: Onset[];
  extra: Onset[];
  proOnsets: Onset[];
  userOnsets: Onset[];
  offsetSec: number; // userTime - offsetSec で Pro の時間軸に揃う
  meanMs: number;
  stdMs: number;
  meanAbsMs: number;
  worst: NotePair | null;
  score: number;
  sub: SubScores;
  tendency: Tendency;
  bpm: number;
  beatStats: BeatStat[];
  advice: Advice[];
};

export type AlignMode = "none" | "first";

// ---------------------------------------------------------------------------
// 基本ユーティリティ
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

// ---------------------------------------------------------------------------
// 1. 振幅エンベロープ & オンセット検出
// ---------------------------------------------------------------------------

/**
 * RMS エンベロープ（hop ごと）を返す。可視化や検出の粗い段階で利用。
 */
export function rmsEnvelope(x: Float32Array, sr: number, hopSec = 0.0025, winSec = 0.01) {
  const hop = Math.max(1, Math.round(sr * hopSec));
  const win = Math.max(hop, Math.round(sr * winSec));
  const frames = Math.max(0, Math.floor((x.length - win) / hop) + 1);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const o = f * hop;
    for (let i = 0; i < win; i++) s += x[o + i] * x[o + i];
    env[f] = Math.sqrt(s / win);
  }
  return { env, hop };
}

/**
 * オンセット検出:
 *  1) 10ms 窓の RMS エンベロープを dB 化し、10ms 前との上昇量（dB）をオンセット関数とする
 *  2) 閾値超えのピークを最小間隔つきで拾う（粗検出）
 *  3) 各候補の周辺でサンプル単位の振幅包絡を見て、ピークの 20% を超えた瞬間を立ち上がり時刻とする（精密化）
 */
export function detectOnsets(buf: AudioBuffer): Onset[] {
  const sr = buf.sampleRate;
  const x = toMono(buf);
  const { env, hop } = rmsEnvelope(x, sr);
  if (env.length < 8) return [];

  let envMax = 0;
  for (let i = 0; i < env.length; i++) envMax = Math.max(envMax, env[i]);
  if (envMax < 1e-5) return [];

  const FLOOR_DB = -50;
  const db = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) {
    db[i] = Math.max(FLOOR_DB, 20 * Math.log10(env[i] / envMax + 1e-9));
  }

  const LAG = 4; // 4 hop = 10ms
  const odf = new Float32Array(env.length);
  for (let i = LAG; i < env.length; i++) odf[i] = Math.max(0, db[i] - db[i - LAG]);

  // 適応しきい値: 局所中央値 + 6dB、かつ絶対 6dB 以上
  const RISE_DB = 6;
  const LEVEL_DB = -32; // ピーク比 -32dB 以下の小さな音は無視
  const minGap = Math.round(0.05 / (hop / sr)); // 50ms
  const localWin = Math.round(0.2 / (hop / sr));
  const candidates: number[] = [];
  let last = -Infinity;
  for (let i = 1; i < odf.length - 1; i++) {
    if (odf[i] < RISE_DB || odf[i] < odf[i - 1] || odf[i] < odf[i + 1]) continue;
    // 上昇後のレベルが十分か
    const ahead = Math.min(db.length - 1, i + LAG);
    if (db[ahead] < LEVEL_DB) continue;
    const lo = Math.max(0, i - localWin);
    const hi = Math.min(odf.length, i + localWin);
    const local: number[] = [];
    for (let k = lo; k < hi; k += 2) local.push(odf[k]);
    if (odf[i] < median(local) + RISE_DB) continue;
    if (i - last < minGap) {
      // 近接している場合は強い方を残す
      if (candidates.length && odf[i] > odf[candidates[candidates.length - 1]]) {
        candidates[candidates.length - 1] = i;
        last = i;
      }
      continue;
    }
    candidates.push(i);
    last = i;
  }

  // 精密化用: 16 サンプル単位の max|x| → 5ms の因果的スライディング max
  const BLK = 16;
  const nb = Math.ceil(x.length / BLK);
  const blk = new Float32Array(nb);
  let gPeak = 0;
  for (let b = 0; b < nb; b++) {
    let m = 0;
    const end = Math.min(x.length, (b + 1) * BLK);
    for (let i = b * BLK; i < end; i++) {
      const a = Math.abs(x[i]);
      if (a > m) m = a;
    }
    blk[b] = m;
    if (m > gPeak) gPeak = m;
  }
  const W = Math.max(1, Math.round((0.005 * sr) / BLK));
  const fine = new Float32Array(nb);
  for (let b = 0; b < nb; b++) {
    let m = 0;
    for (let k = Math.max(0, b - W + 1); k <= b; k++) if (blk[k] > m) m = blk[k];
    fine[b] = m;
  }

  const onsets: Onset[] = [];
  for (const c of candidates) {
    const center = (c * hop + hop * 2) / BLK; // 窓中心付近
    const from = Math.max(0, Math.floor(center - (0.03 * sr) / BLK));
    const to = Math.min(nb - 1, Math.ceil(center + (0.04 * sr) / BLK));
    let pIdx = from;
    for (let b = from; b <= to; b++) if (fine[b] > fine[pIdx]) pIdx = b;
    const P = fine[pIdx];
    const thr = P * 0.2;
    let b = pIdx;
    while (b > from && fine[b - 1] >= thr) b--;
    const time = (b * BLK) / sr;
    if (onsets.length && time - onsets[onsets.length - 1].time < 0.04) continue;
    onsets.push({ time, peak: gPeak > 0 ? P / gPeak : 0 });
  }
  return onsets;
}

// ---------------------------------------------------------------------------
// 2. オンセットの対応付け（動的計画法による単調アライメント）
// ---------------------------------------------------------------------------

function alignOnsets(pro: number[], user: number[], tol: number) {
  const n = pro.length;
  const m = user.length;
  const GAP = tol;
  const INF = 1e9;
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
  const from = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 0 match,1 skip pro,2 skip user
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
      if (i < n && c + GAP < cost[i + 1][j]) {
        cost[i + 1][j] = c + GAP;
        from[i + 1][j] = 1;
      }
      if (j < m && c + GAP < cost[i][j + 1]) {
        cost[i][j + 1] = c + GAP;
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

/** Pro のオンセット間隔から拍の長さ（秒）を推定する */
function estimateBeat(times: number[]) {
  const iois: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0.06 && d < 2) iois.push(d);
  }
  let beat = median(iois) || 0.5;
  while (beat < 0.4) beat *= 2;
  while (beat > 1.0) beat /= 2;
  return beat;
}

// ---------------------------------------------------------------------------
// 3. スコア & アドバイス
// ---------------------------------------------------------------------------

export function analyzeGroove(proBuf: AudioBuffer, userBuf: AudioBuffer, align: AlignMode): GrooveResult {
  const proOnsets = detectOnsets(proBuf);
  const userOnsets = detectOnsets(userBuf);
  const proT = proOnsets.map((o) => o.time);
  const rawUserT = userOnsets.map((o) => o.time);

  const offsetSec = align === "first" && proT.length && rawUserT.length ? rawUserT[0] - proT[0] : 0;
  const userT = rawUserT.map((t) => t - offsetSec);

  const beat = estimateBeat(proT);
  const bpm = 60 / beat;
  const tol = clamp(beat * 0.22, 0.04, 0.2);

  const { matches, missed, extra } = alignOnsets(proT, userT, tol);
  const t0 = proT[0] ?? 0;
  const half = beat / 2;

  const pairs: NotePair[] = matches.map(([pi, ui], k) => {
    const pos8 = Math.round((proT[pi] - t0) / half);
    return {
      index: k,
      proTime: proT[pi],
      userTime: rawUserT[ui],
      devMs: (userT[ui] - proT[pi]) * 1000,
      bar: Math.floor(pos8 / 8) + 1,
      beat: (Math.floor(pos8 / 2) % 4) + 1,
      offbeat: pos8 % 2 === 1,
      proPeak: proOnsets[pi].peak,
      userPeak: userOnsets[ui].peak,
    };
  });

  // 先頭アライメント時、先頭ペアは定義上 0ms なので統計から除外
  const statPairs = align === "first" && pairs.length > 1 && Math.abs(pairs[0].devMs) < 1e-3 ? pairs.slice(1) : pairs;
  const devs = statPairs.map((p) => p.devMs);
  const meanMs = mean(devs);
  const stdMs = std(devs);
  const meanAbsMs = mean(devs.map(Math.abs));
  const worst = statPairs.reduce<NotePair | null>(
    (w, p) => (!w || Math.abs(p.devMs) > Math.abs(w.devMs) ? p : w),
    null,
  );

  // サブスコア
  const accuracy = devs.length ? 100 * mean(devs.map((d) => Math.exp(-((d / 45) ** 2)))) : 0;
  const stability = devs.length ? 100 * Math.exp(-((stdMs / 35) ** 2)) : 0;
  const pocket = devs.length ? 100 * Math.exp(-((meanMs / 40) ** 2)) : 0;
  const denom = Math.max(proOnsets.length, userOnsets.length);
  const completeness = denom ? (100 * pairs.length) / denom : 0;

  // 強弱: 各トラックの平均で正規化した dB 差
  let dynamics = 0;
  if (pairs.length) {
    const pm = mean(pairs.map((p) => p.proPeak)) || 1;
    const um = mean(pairs.map((p) => p.userPeak)) || 1;
    const dbDiff = mean(
      pairs.map((p) => Math.abs(20 * Math.log10((p.userPeak / um + 1e-6) / (p.proPeak / pm + 1e-6)))),
    );
    dynamics = 100 * Math.exp(-((dbDiff / 6) ** 2));
  }

  const sub: SubScores = { accuracy, stability, pocket, completeness, dynamics };
  const score = Math.round(
    clamp((0.55 * accuracy + 0.2 * stability + 0.15 * pocket + 0.1 * dynamics) * (completeness / 100), 0, 100),
  );

  const tendency: Tendency = meanMs <= -8 ? "rush" : meanMs >= 8 ? "drag" : "stable";

  // 拍ごとの統計（表拍1..4 + 裏拍）
  const beatStats: BeatStat[] = [];
  for (const offbeat of [false, true]) {
    for (let b = 1; b <= 4; b++) {
      const ds = statPairs.filter((p) => p.beat === b && p.offbeat === offbeat).map((p) => p.devMs);
      if (ds.length) beatStats.push({ beat: b, offbeat, meanMs: mean(ds), count: ds.length });
    }
  }

  const result: GrooveResult = {
    pairs,
    missed: missed.map((i) => proOnsets[i]),
    extra: extra.map((j) => userOnsets[j]),
    proOnsets,
    userOnsets,
    offsetSec,
    meanMs,
    stdMs,
    meanAbsMs,
    worst,
    score,
    sub,
    tendency,
    bpm,
    beatStats,
    advice: [],
  };
  result.advice = buildAdvice(result);
  return result;
}

const fmtMs = (ms: number) => `${ms >= 0 ? "+" : ""}${Math.round(ms)}ms`;
const fmtSec = (ms: number) => `${(Math.abs(ms) / 1000).toFixed(2)}秒`;
const beatLabel = (s: { beat: number; offbeat: boolean }) => `${s.beat}拍目${s.offbeat ? "の裏" : ""}`;

function buildAdvice(r: GrooveResult): Advice[] {
  const out: Advice[] = [];
  if (!r.pairs.length) {
    out.push({
      level: "critical",
      title: "対応する音が見つかりません",
      body: "オンセットを検出できなかったか、2つの音源のテンポ・位置が大きく異なります。録音レベルや開始位置を確認してください。",
    });
    return out;
  }

  // 1) 全体の重心
  const avg = Math.round(Math.abs(r.meanMs));
  if (r.tendency === "rush") {
    out.push({
      level: avg >= 20 ? "critical" : "warning",
      title: `全体的に平均${avg}ms 走り気味（前ノリ）`,
      body: `お手本より平均 ${avg}ms 早く音が出ています。クリックや お手本のキックを「聴いてから」弾くくらいの意識で、${fmtSec(r.meanMs)} 後ろに重心を置きましょう。`,
    });
  } else if (r.tendency === "drag") {
    out.push({
      level: avg >= 20 ? "critical" : "warning",
      title: `全体的に平均${avg}ms もたり気味（後ノリ）`,
      body: `お手本より平均 ${avg}ms 遅れています。レイドバックが意図的でなければ、音の準備（指・スティックの予備動作）を早め、${fmtSec(r.meanMs)} 前に詰めましょう。`,
    });
  } else {
    out.push({
      level: "good",
      title: "ノリの重心はお手本とほぼ一致",
      body: `平均ズレは ${fmtMs(r.meanMs)} で、ポケット（グルーヴの重心）を捉えられています。`,
    });
  }

  // 2) 拍ごとの癖
  const off = r.beatStats.filter((s) => s.count >= 2 && Math.abs(s.meanMs - r.meanMs) >= 10 && Math.abs(s.meanMs) >= 12);
  const early = off.filter((s) => s.meanMs < 0);
  const late = off.filter((s) => s.meanMs > 0);
  if (early.length) {
    const m = mean(early.map((s) => s.meanMs));
    out.push({
      level: Math.abs(m) >= 25 ? "critical" : "warning",
      title: `${early.map(beatLabel).join("・")}が突っ込みがち（平均${fmtMs(m)}）`,
      body: `${early.map(beatLabel).join("・")}をあと${fmtSec(m)}タメるとグルーヴが出ます。その拍の直前で一瞬「待つ」感覚を持ちましょう。`,
    });
  }
  if (late.length) {
    const m = mean(late.map((s) => s.meanMs));
    out.push({
      level: Math.abs(m) >= 25 ? "critical" : "warning",
      title: `${late.map(beatLabel).join("・")}が遅れがち（平均${fmtMs(m)}）`,
      body: `${late.map(beatLabel).join("・")}をあと${fmtSec(m)}前に詰めると、リズムが前に進む推進力が生まれます。`,
    });
  }

  // 3) 安定性
  const sd = Math.round(r.stdMs);
  if (r.stdMs > 18) {
    out.push({
      level: "critical",
      title: `タイミングのばらつきが大きい（±${sd}ms）`,
      body: "1音ごとのズレ幅が揃っていません。BPMを10〜20落としてメトロノームと合わせ、ズレを一定に保つ練習から始めましょう。",
    });
  } else if (r.stdMs > 10) {
    out.push({
      level: "warning",
      title: `ばらつきはやや大きめ（±${sd}ms）`,
      body: "グルーヴの「癖」が一定になるとプロらしいノリに近づきます。同じフレーズをループ録音して、毎回同じズレ方になるか確認しましょう。",
    });
  } else {
    out.push({
      level: "good",
      title: `タイミングは安定しています（±${sd}ms）`,
      body: "ズレのばらつきが小さく、再現性の高い演奏です。",
    });
  }

  // 4) 最大ズレ
  if (r.worst && Math.abs(r.worst.devMs) >= 25) {
    const w = r.worst;
    out.push({
      level: "info",
      title: `最大のズレ: ${w.bar}小節目 ${beatLabel(w)}（${fmtMs(w.devMs)}）`,
      body: `この箇所は${w.devMs < 0 ? "早すぎ" : "遅すぎ"}です。波形ビューで該当位置を確認し、前後のフレーズを部分練習しましょう。`,
    });
  }

  // 5) 音数
  if (r.missed.length || r.extra.length) {
    out.push({
      level: "warning",
      title: `音数の不一致（抜け ${r.missed.length} / 余分 ${r.extra.length}）`,
      body: "お手本にある音が検出できない、または余分な音が検出されました。ゴーストノートや弾き損じがないか確認しましょう。",
    });
  }

  // 6) 強弱
  if (r.sub.dynamics < 60) {
    out.push({
      level: "info",
      title: "強弱（ダイナミクス）の付け方に差があります",
      body: "グルーヴはタイミングだけでなくアクセントでも生まれます。お手本で強く鳴っている拍を意識して弾き分けましょう。",
    });
  }
  return out;
}
