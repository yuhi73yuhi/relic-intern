/** Web Audio 周りの共通ユーティリティ（デコード・デモ生成・録音・再生） */

let sharedCtx: AudioContext | null = null;
export function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const ab = await blob.arrayBuffer();
  return getAudioContext().decodeAudioData(ab);
}

// ---------------------------------------------------------------------------
// デモ音源生成（OfflineAudioContext + Oscillator）
// ---------------------------------------------------------------------------

/** 再現性のある疑似乱数 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Hit = { time: number; kind: "kick" | "snare" | "hat"; gain: number };

function scheduleHit(ctx: OfflineAudioContext, noise: AudioBuffer, h: Hit) {
  const t = h.time;
  const out = ctx.createGain();
  out.connect(ctx.destination);

  if (h.kind === "kick") {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * h.gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.4);
  } else if (h.kind === "snare") {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * h.gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.2);

    const n = ctx.createBufferSource();
    n.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "highpass";
    bp.frequency.value = 1200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.6 * h.gain, t + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    n.connect(bp).connect(ng).connect(out);
    n.start(t);
    n.stop(t + 0.2);
  } else {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.45 * h.gain, t + 0.001);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(hp).connect(ng).connect(out);
    n.start(t);
    n.stop(t + 0.06);
  }
}

/**
 * 8ビートのドラムパターン（キック: 1,3拍 / スネア: 2,4拍 / ハイハット: 8分裏）を 4 小節分生成。
 * user=true のときは「2・4拍目が突っ込み、裏拍もやや走る」人間らしいズレを加える。
 */
export async function generateDemo(user: boolean, bpm = 96): Promise<AudioBuffer> {
  const sr = 44100;
  const beat = 60 / bpm;
  const bars = 4;
  const lead = 0.25;
  const duration = lead + bars * 4 * beat + 0.6;
  const ctx = new OfflineAudioContext(1, Math.ceil(duration * sr), sr);

  const noise = ctx.createBuffer(1, sr, sr);
  const nd = noise.getChannelData(0);
  const rnd0 = rng(7);
  for (let i = 0; i < nd.length; i++) nd[i] = rnd0() * 2 - 1;

  const rand = rng(42);
  const jitter = (ms: number) => (rand() * 2 - 1) * ms;
  const hits: Hit[] = [];

  for (let bar = 0; bar < bars; bar++) {
    for (let b = 0; b < 4; b++) {
      const on = lead + (bar * 4 + b) * beat;
      const first = bar === 0 && b === 0;
      let devMs = 0;
      let gain = 1;
      if (user && !first) {
        if (b === 1 || b === 3) {
          devMs = -26 + jitter(7); // 2・4拍目が突っ込む
          gain = 0.85 + rand() * 0.3;
        } else {
          devMs = -6 + jitter(6);
          gain = 0.9 + rand() * 0.2;
        }
        if (bar === 2 && b === 2) devMs = 38; // 1か所だけ大きくもたる
      }
      hits.push({ time: on + devMs / 1000, kind: b === 1 || b === 3 ? "snare" : "kick", gain });

      // 8分裏のハイハット
      const offT = on + beat / 2;
      let offDev = 0;
      let hatGain = 1;
      if (user) {
        if (bar === 3 && b === 1) continue; // 1音抜け
        offDev = -12 + jitter(9);
        hatGain = 0.6 + rand() * 0.5;
      }
      hits.push({ time: offT + offDev / 1000, kind: "hat", gain: hatGain });
    }
  }

  for (const h of hits) scheduleHit(ctx, noise, h);
  const rendered = await ctx.startRendering();

  if (user) {
    // 録音っぽいノイズフロアを足す
    const d = rendered.getChannelData(0);
    const r = rng(99);
    for (let i = 0; i < d.length; i++) d[i] += (r() * 2 - 1) * 0.002;
  }
  return rendered;
}

// ---------------------------------------------------------------------------
// マイク録音（MediaRecorder）
// ---------------------------------------------------------------------------

export type RecorderHandle = { stop: () => Promise<AudioBuffer> };

export async function startRecording(): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    stop: () =>
      new Promise<AudioBuffer>((resolve, reject) => {
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          try {
            resolve(await decodeBlob(new Blob(chunks, { type: rec.mimeType })));
          } catch (e) {
            reject(e);
          }
        };
        rec.stop();
      }),
  };
}

// ---------------------------------------------------------------------------
// 再生
// ---------------------------------------------------------------------------

export type Playback = { stop: () => void; startedAt: number; ctx: AudioContext };

/** skip: 各バッファの再生開始位置（秒）。User を Pro の時間軸に揃えて同時再生するために使う */
export function playBuffers(items: { buffer: AudioBuffer; skip: number }[], onEnded: () => void): Playback {
  const ctx = getAudioContext();
  void ctx.resume();
  const startedAt = ctx.currentTime + 0.05;
  let remaining = items.length;
  const srcs = items.map(({ buffer: b, skip }) => {
    const s = ctx.createBufferSource();
    s.buffer = b;
    const g = ctx.createGain();
    g.gain.value = items.length > 1 ? 0.7 : 1;
    s.connect(g).connect(ctx.destination);
    s.onended = () => {
      remaining--;
      if (remaining === 0) onEnded();
    };
    s.start(startedAt, Math.max(0, skip));
    return s;
  });
  return {
    ctx,
    startedAt,
    stop: () =>
      srcs.forEach((s) => {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }),
  };
}
