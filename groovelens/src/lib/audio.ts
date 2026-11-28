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

/** 指定区間だけを再生（ノート単位の A/B 比較用） */
export function playSegment(buf: AudioBuffer, startSec: number, durSec: number, when = 0) {
  const ctx = getAudioContext();
  void ctx.resume();
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.connect(ctx.destination);
  s.start(ctx.currentTime + 0.03 + when, Math.max(0, startSec), durSec);
  return s;
}
