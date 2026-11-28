/**
 * デモ音源の合成（OfflineAudioContext + Oscillator）とスマホ録音シミュレーション。
 * 「先生のお手本」と「生徒の演奏」を、楽器 × ジャンルごとのパターンで生成する。
 * 生徒側にはタイミング・強弱・アタック・音の長さ・ピッチのズレを意図的に入れ、正解値（truth）も返す。
 */
import { GENRES, type GenreId, type InstrumentId } from "./profiles";

type PNote = { pos: number; dur: number; acc: number; role: string; midi: number[] };

export type TruthNote = {
  teacherTime: number;
  studentTime: number | null;
  teacherGain: number;
  studentGain: number;
};

export type DemoSet = {
  teacher: AudioBuffer;
  student: AudioBuffer;
  truth: TruthNote[];
  bpm: number;
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ---------------------------------------------------------------------------
// パターン（すべてオリジナルのフレーズ）
// ---------------------------------------------------------------------------

function pattern(inst: InstrumentId, genre: GenreId): PNote[] {
  const out: PNote[] = [];
  const bars = 4;
  const n = (pos: number, dur: number, acc: number, role: string, midi: number[] = []) => out.push({ pos, dur, acc, role, midi });

  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * 4;
    if (inst === "drums" && genre === "funk") {
      const map: Record<number, [string, number]> = {
        0: ["kick+hat", 0.9], 2: ["hat", 0.5], 3: ["kick", 0.75], 4: ["snare+hat", 1], 6: ["hat", 0.5],
        7: ["ghost", 0.18], 8: ["hat", 0.7], 9: ["ghost", 0.18], 10: ["kick+hat", 0.85], 12: ["snare+hat", 1],
        14: ["hat", 0.5], 15: ["ghost", 0.2],
      };
      for (const [s, [role, acc]] of Object.entries(map)) n(b0 + Number(s) / 4, 0.25, acc, role);
    } else if (inst === "drums") {
      const roles = ["kick+hat", "hat", "snare+hat", "hat", "kick+hat", "kick+hat", "snare+hat", "hat"];
      roles.forEach((r, i) => n(b0 + i / 2, 0.5, r.includes("snare") ? 1 : r.includes("kick") ? 0.85 : 0.5, r));
    } else if (inst === "bass" && genre === "funk") {
      const ph: [number, number, number, number][] = [
        [0, 0.22, 1, 40], [0.75, 0.2, 0.5, 40], [1.5, 0.22, 0.8, 43], [2, 0.45, 0.9, 45],
        [2.75, 0.2, 0.45, 40], [3.25, 0.2, 0.6, 50], [3.5, 0.4, 0.9, 52],
      ];
      ph.forEach(([p, d, a, m]) => n(b0 + p, d, a, "note", [m]));
    } else if (inst === "bass") {
      const root = [40, 40, 45, 43][bar];
      for (let i = 0; i < 8; i++) n(b0 + i / 2, 0.42, i % 2 ? 0.55 : 0.9, "note", [root]);
    } else if (inst === "guitar" && genre === "funk") {
      const chord = [52, 56, 62, 66];
      const acc: Record<number, number> = { 4: 1, 7: 0.8, 10: 0.85, 12: 1 };
      for (let s = 0; s < 16; s++) {
        if (acc[s]) n(b0 + s / 4, 0.18, acc[s], "chord", chord);
        else n(b0 + s / 4, 0.08, 0.28, "mute");
      }
    } else if (inst === "guitar") {
      const roots = [40, 40, 45, 43][bar];
      for (let i = 0; i < 8; i++) n(b0 + i / 2, 0.4, i % 2 ? 0.6 : 0.9, "chord", [roots, roots + 7, roots + 12]);
    } else if (inst === "piano" && genre === "jazz") {
      const chords = [[50, 53, 57, 60], [50, 53, 57, 60], [53, 55, 59, 62], [48, 52, 55, 59]][bar];
      const pos = [0, 2 / 3, 1, 5 / 3, 2, 8 / 3, 3, 11 / 3];
      pos.forEach((p, i) => {
        const off = i % 2 === 1;
        const acc = off ? 0.8 : i === 2 || i === 6 ? 0.7 : 0.5;
        n(b0 + p, off ? 0.28 : 0.55, acc, "chord", chords);
      });
    } else if (inst === "piano") {
      const chords = [[48, 52, 55, 60], [47, 50, 55, 59], [45, 48, 52, 57], [41, 45, 48, 53]][bar];
      for (let i = 0; i < 8; i++) n(b0 + i / 2, 0.45, i % 2 ? 0.5 : 0.85, "chord", chords);
    }
  }

  if (inst === "vocal") {
    const phrase: [number, number, number, number][] =
      genre === "ballad"
        ? [[0, 1.7, 0.6, 60], [2, 0.85, 0.7, 64], [3, 0.85, 0.8, 67], [4, 1.7, 0.95, 69], [6, 0.85, 0.7, 67], [7, 0.8, 0.6, 64]]
        : [[0, 0.85, 0.75, 64], [1, 0.85, 0.75, 67], [2, 0.42, 0.65, 69], [2.5, 0.42, 0.7, 67], [3, 0.85, 0.85, 64],
           [4, 0.85, 0.7, 62], [5, 0.42, 0.65, 64], [5.5, 0.42, 0.75, 67], [6, 1.7, 0.95, 69]];
    for (const off of [0, 8]) phrase.forEach(([p, d, a, m]) => n(off + p, d, a, "voice", [m]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 生徒の「ありがちなズレ」
// ---------------------------------------------------------------------------

type Perf = { time: number; gain: number; attackMs: number; durScale: number; cents: number; decayScale: number; play: boolean };

const ATTACK: Record<InstrumentId, [number, number]> = {
  drums: [1, 1.5],
  bass: [4, 14],
  guitar: [1.5, 7],
  piano: [2, 9],
  vocal: [25, 75],
};

function perform(notes: PNote[], inst: InstrumentId, genre: GenreId, student: boolean, beat: number, seed: number): Perf[] {
  const r = rng(seed);
  const j = (ms: number) => (r() * 2 - 1) * ms;
  // 生徒は 4 小節目の一番弱い音を 1 つ弾き損じる
  let missIdx = -1;
  if (student) {
    notes.forEach((nn, i) => {
      if (nn.pos >= 12.5 && nn.pos < 14 && (missIdx < 0 || nn.acc < notes[missIdx].acc)) missIdx = i;
    });
  }

  return notes.map((nn, i) => {
    const beatIdx = Math.floor(nn.pos + 1e-6) % 4; // 0..3
    const frac = nn.pos - Math.floor(nn.pos + 1e-6);
    const onBeat = frac < 0.01;
    const backbeat = onBeat && (beatIdx === 1 || beatIdx === 3);
    let devMs = 0;
    let pos = nn.pos;

    if (i === 0) devMs = 0; // 先頭はアンカー
    else if (!student) {
      // 先生の「意図的なノリ」: バックビートを少し後ろに置く、など
      devMs = j(2.5);
      if (backbeat && (genre === "funk" || genre === "rock")) devMs += genre === "funk" ? 8 : 5;
      if (genre === "ballad") devMs += 6;
    } else {
      if (inst === "vocal") {
        devMs = j(8) + (beatIdx === 2 && onBeat ? -22 : -6);
      } else if (genre === "jazz" && !onBeat) {
        pos = Math.floor(nn.pos) + 0.6; // スウィングが浅い（ハネが足りない）
        devMs = j(5);
      } else if (backbeat) {
        devMs = -18 + j(6);
      } else if (!onBeat) {
        devMs = -7 + j(6);
      } else {
        devMs = j(5);
      }
      if (Math.abs(nn.pos - 10) < 1e-6) devMs = 34; // 1か所だけ大きくもたる
    }

    const [ta, sa] = ATTACK[inst];
    const gain = student ? 0.62 + 0.38 * nn.acc : 0.22 + 0.78 * nn.acc;
    let durScale = 1;
    let decayScale = 1;
    let cents = student ? j(5) : j(2);
    if (student) {
      if (inst === "bass") durScale = 0.55;
      if (inst === "piano") durScale = nn.dur > 0.4 ? 0.65 : 1;
      if (inst === "guitar") durScale = nn.role === "chord" ? (genre === "funk" ? 1.35 : 1.15) : 1;
      if (inst === "vocal") durScale = nn.dur > 0.8 ? 0.7 : 1;
      if (inst === "drums" && nn.role.includes("hat")) decayScale = 1.9;
      if (inst === "vocal" && nn.midi[0] >= 67) cents = -28 + j(5);
    }
    return {
      time: pos * beat + devMs / 1000,
      gain: gain * (0.95 + r() * 0.1),
      attackMs: student ? sa * (0.85 + r() * 0.3) : ta,
      durScale,
      cents,
      decayScale,
      play: i !== missIdx,
    };
  });
}

// ---------------------------------------------------------------------------
// 音色
// ---------------------------------------------------------------------------

function env(g: GainNode, t: number, peak: number, attackS: number) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.max(0.0008, attackS));
}

function voice(ctx: OfflineAudioContext, noise: AudioBuffer, inst: InstrumentId, nn: PNote, p: Perf, beat: number) {
  const t = p.time;
  const a = p.attackMs / 1000;
  const dur = nn.dur * beat * p.durScale;
  const g0 = p.gain;
  const out = ctx.destination;

  const noiseHit = (freq: number, type: BiquadFilterType, peak: number, decay: number, q = 0.8) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, peak, Math.min(a, 0.004));
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    s.connect(f).connect(g).connect(out);
    s.start(t, (t * 7.31) % 0.5);
    s.stop(t + decay + 0.02);
  };

  if (inst === "drums") {
    if (nn.role.includes("kick")) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
      const g = ctx.createGain();
      env(g, t, 0.9 * g0, a);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.4);
    }
    if (nn.role.includes("snare") || nn.role.includes("ghost")) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = 210;
      const g = ctx.createGain();
      env(g, t, 0.45 * g0, a);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.16);
      noiseHit(1500, "highpass", 0.6 * g0, 0.17);
    }
    if (nn.role.includes("hat")) noiseHit(7000, "highpass", 0.4 * g0, 0.05 * p.decayScale);
    return;
  }

  if (inst === "guitar" && nn.role === "mute") {
    noiseHit(1800, "bandpass", 0.9 * g0, 0.035, 1.2);
    return;
  }

  const release = inst === "vocal" ? 0.06 : 0.03;
  for (const m of nn.midi) {
    const f = hz(m);
    const g = ctx.createGain();
    const lvl = (g0 * (inst === "vocal" ? 0.5 : 0.7)) / Math.sqrt(nn.midi.length);
    env(g, t, lvl, a);
    if (inst === "piano") g.gain.setTargetAtTime(lvl * 0.25, t + a, 0.6);
    else if (inst === "guitar") g.gain.setTargetAtTime(lvl * 0.2, t + a, 0.18);
    else if (inst === "bass") g.gain.setTargetAtTime(lvl * 0.55, t + a, 0.3);
    else g.gain.setTargetAtTime(lvl * 0.85, t + a, 0.4);
    g.gain.setTargetAtTime(0, t + dur, release / 3);

    const o = ctx.createOscillator();
    o.frequency.value = f;
    o.detune.value = p.cents;
    let src: AudioNode = o;
    if (inst === "bass") {
      o.type = "sawtooth";
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      src = o.connect(lp);
    } else if (inst === "guitar") {
      o.type = "sawtooth";
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2800;
      src = o.connect(lp);
    } else if (inst === "piano") {
      o.type = "triangle";
    } else {
      // ボーカル: ノコギリ波 + フォルマント（「あ」）+ ビブラート
      o.type = "sawtooth";
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(0, t + 0.25);
      depth.gain.linearRampToValueAtTime(18, t + 0.5);
      lfo.connect(depth).connect(o.detune);
      lfo.start(t);
      lfo.stop(t + dur + 0.3);
      const mix = ctx.createGain();
      for (const [ff, q, gg] of [[800, 6, 1], [1150, 7, 0.6], [2900, 9, 0.35]] as const) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = ff;
        bp.Q.value = q;
        const bg = ctx.createGain();
        bg.gain.value = gg * 3;
        o.connect(bp).connect(bg).connect(mix);
      }
      src = mix;
    }
    src.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.4);
  }
  // 実際の楽器にある発音の瞬間のノイズ（ピック・指・ハンマー）
  if (inst === "guitar") noiseHit(2500, "highpass", 0.25 * g0, 0.012);
  if (inst === "bass") noiseHit(1200, "bandpass", 0.12 * g0, 0.015, 1);
  if (inst === "piano") noiseHit(2500, "highpass", 0.15 * g0, 0.012);
}

async function render(inst: InstrumentId, notes: PNote[], perf: Perf[], beat: number, lead: number): Promise<AudioBuffer> {
  const sr = 44100;
  const last = notes[notes.length - 1];
  const duration = lead + (last.pos + last.dur) * beat + 1.0;
  const ctx = new OfflineAudioContext(1, Math.ceil(duration * sr), sr);
  const noise = ctx.createBuffer(1, sr, sr);
  const nd = noise.getChannelData(0);
  const r = rng(7);
  for (let i = 0; i < nd.length; i++) nd[i] = r() * 2 - 1;
  notes.forEach((nn, i) => perf[i].play && voice(ctx, noise, inst, nn, { ...perf[i], time: perf[i].time + lead }, beat));
  return ctx.startRendering();
}

// ---------------------------------------------------------------------------
// スマホ録音シミュレーション
// ---------------------------------------------------------------------------

/** スマホ内蔵マイク相当: 低域カット・高域ロールオフ・部屋の反響・自動ゲイン（コンプレッサー）・ノイズ・録音開始の遅れ */
export async function simulatePhone(buf: AudioBuffer, seed: number, latencySec: number): Promise<AudioBuffer> {
  const sr = buf.sampleRate;
  const pad = Math.round(latencySec * sr);
  const ctx = new OfflineAudioContext(1, buf.length + pad, sr);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 120;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 7500;
  const conv = ctx.createConvolver();
  const irLen = Math.round(sr * 0.3);
  const ir = ctx.createBuffer(1, irLen, sr);
  const id = ir.getChannelData(0);
  const r = rng(seed);
  for (let i = 0; i < irLen; i++) id[i] = (r() * 2 - 1) * Math.exp(-i / (sr * 0.06));
  id[0] = 1;
  conv.buffer = ir;
  conv.normalize = true;
  const wet = ctx.createGain();
  wet.gain.value = 0.18;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -26;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  const sum = ctx.createGain();
  src.connect(hp).connect(lp);
  lp.connect(sum);
  lp.connect(conv).connect(wet).connect(sum);
  sum.connect(comp).connect(ctx.destination);
  src.start(latencySec);
  const out = await ctx.startRendering();
  const d = out.getChannelData(0);
  let peak = 1e-6;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const k = (0.7 + r() * 0.2) / peak;
  for (let i = 0; i < d.length; i++) d[i] = d[i] * k + (r() * 2 - 1) * 0.003; // 約 -50dBFS のノイズ
  return out;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

export async function generateDemoSet(inst: InstrumentId, genre: GenreId, opts: { phone: boolean; seed?: number }): Promise<DemoSet> {
  const seed = opts.seed ?? 42;
  const bpm = GENRES[genre].bpm;
  const beat = 60 / bpm;
  const notes = pattern(inst, genre);
  const tp = perform(notes, inst, genre, false, beat, seed);
  const sp = perform(notes, inst, genre, true, beat, seed + 1);
  const lead = 0.3;
  let teacher = await render(inst, notes, tp, beat, lead);
  let student = await render(inst, notes, sp, beat, lead);
  let tLat = 0;
  let sLat = 0;
  if (opts.phone) {
    const r = rng(seed + 5);
    tLat = 0.05 + r() * 0.2;
    sLat = 0.1 + r() * 0.35;
    teacher = await simulatePhone(teacher, seed + 11, tLat);
    student = await simulatePhone(student, seed + 13, sLat);
  }
  const truth: TruthNote[] = notes.map((_, i) => ({
    teacherTime: tp[i].time + lead + tLat,
    studentTime: sp[i].play ? sp[i].time + lead + sLat : null,
    teacherGain: tp[i].gain,
    studentGain: sp[i].gain,
  }));
  return { teacher, student, truth, bpm };
}
