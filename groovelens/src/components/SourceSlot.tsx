"use client";

import { useRef, useState } from "react";
import { decodeBlob, startRecording, type RecorderHandle } from "@/lib/audio";
import type { Quality } from "@/lib/quality";

type Props = {
  role: "pro" | "user";
  title: string;
  subtitle: string;
  color: string;
  buffer: AudioBuffer | null;
  name: string | null;
  onLoad: (buf: AudioBuffer, name: string) => void;
  onPlay: () => void;
  playing: boolean;
  quality: Quality | null;
};

export default function SourceSlot({ role, title, subtitle, color, buffer, name, onLoad, onPlay, playing, quality }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<RecorderHandle | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const timerRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFile = async (file: File) => {
    setError(null);
    if (!/audio\//.test(file.type) && !/\.(wav|mp3|m4a|ogg|flac|aac|webm)$/i.test(file.name)) {
      setError("WAV / MP3 などの音声ファイルを選択してください");
      return;
    }
    setBusy(true);
    try {
      onLoad(await decodeBlob(file), file.name);
    } catch {
      setError("音声ファイルをデコードできませんでした");
    } finally {
      setBusy(false);
    }
  };

  const toggleRecord = async () => {
    setError(null);
    if (recording) {
      setRecording(false);
      if (timerRef.current) window.clearInterval(timerRef.current);
      setBusy(true);
      try {
        const buf = await recRef.current!.stop();
        onLoad(buf, `マイク録音 ${new Date().toLocaleTimeString("ja-JP")}`);
      } catch {
        setError("録音データを読み込めませんでした");
      } finally {
        setBusy(false);
        recRef.current = null;
      }
      return;
    }
    try {
      recRef.current = await startRecording();
      setRecording(true);
      setRecSec(0);
      const t0 = Date.now();
      timerRef.current = window.setInterval(() => setRecSec((Date.now() - t0) / 1000), 100);
    } catch {
      setError("マイクにアクセスできません（ブラウザの許可設定を確認してください）");
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void loadFile(f);
      }}
      className={`relative flex flex-col gap-3 rounded-xl border p-4 transition-colors ${
        drag ? "border-emerald-400 bg-emerald-500/5" : "border-zinc-800 bg-[#11161d]"
      }`}
      data-role={role}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="h-8 w-1 rounded-full" style={{ background: color }} />
          <div>
            <div className="text-sm font-semibold text-zinc-100">{title}</div>
            <div className="text-[11px] text-zinc-500">{subtitle}</div>
          </div>
        </div>
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
            buffer ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-zinc-500"
          }`}
        >
          {buffer ? "LOADED" : "EMPTY"}
        </span>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex h-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-700 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
      >
        {busy ? (
          <span className="animate-pulse">読み込み中…</span>
        ) : buffer ? (
          <>
            <span className="max-w-full truncate px-2 font-medium text-zinc-200">{name}</span>
            <span className="font-mono text-[10px] text-zinc-500">
              {buffer.duration.toFixed(2)}s · {buffer.sampleRate}Hz · {buffer.numberOfChannels}ch
            </span>
          </>
        ) : (
          <>
            <span className="text-zinc-300">ドラッグ＆ドロップ</span>
            <span className="text-[10px] text-zinc-500">またはクリックして WAV / MP3 を選択</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.wav,.mp3"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadFile(f);
          e.target.value = "";
        }}
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={toggleRecord}
          disabled={busy}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
            recording
              ? "border-rose-500/60 bg-rose-500/15 text-rose-200"
              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${recording ? "animate-pulse bg-rose-500" : "bg-rose-500/70"}`} />
          {recording ? `停止 ${recSec.toFixed(1)}s` : "マイク録音"}
        </button>
        <button
          type="button"
          onClick={onPlay}
          disabled={!buffer}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 disabled:opacity-40"
        >
          {playing ? "■ 停止" : "▶ 再生"}
        </button>
      </div>
      {quality && (
        <div className="flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-950/50 px-2.5 py-1.5 text-[11px]">
          <span
            className="mt-px shrink-0 rounded px-1.5 font-semibold"
            style={{
              color: quality.level === "good" ? "#10b981" : quality.level === "warning" ? "#f59e0b" : "#f43f5e",
              background: quality.level === "good" ? "#10b98118" : quality.level === "warning" ? "#f59e0b18" : "#f43f5e18",
            }}
          >
            録音品質 {quality.level === "good" ? "良好" : quality.level === "warning" ? "注意" : "要再録音"}
          </span>
          <span className="text-zinc-400">
            {quality.messages[0]}
            <span className="ml-1 font-mono text-zinc-600">SNR {quality.snrDb.toFixed(0)}dB</span>
          </span>
        </div>
      )}
      {error && <p className="text-[11px] text-rose-400">{error}</p>}
    </div>
  );
}
