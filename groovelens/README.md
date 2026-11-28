# GrooveLens

楽器演奏の「グルーヴ（発音タイミングの微細なズレ・ニュアンス）」を可視化する Web アプリ（MVP）。
音声解析はすべてブラウザ内の Web Audio API で完結し、音声はサーバーに送信されません。

## 起動

```bash
npm install
npm run dev
```

http://localhost:3000 を開き、「デモ音源をロード」を押すとすぐに解析結果を確認できます。

## 機能

- お手本（Pro）/ 自分（User）の音源読み込み：ドラッグ＆ドロップ、ファイル選択（WAV/MP3 等）、マイク録音（MediaRecorder）
- デモ音源生成：OfflineAudioContext + Oscillator で 96BPM の 8 ビートを生成（User 側は 2・4 拍が突っ込む等のズレを付与）
- 解析エンジン（`src/lib/groove.ts`）
  - RMS エンベロープ（10ms 窓 / 2.5ms hop）の dB 上昇量でオンセットを粗検出
  - サンプル単位の振幅包絡でピークの 20% を超えた瞬間に精密化（誤差 < 1ms）
  - 動的計画法で Pro / User のオンセットを単調に対応付け、抜け・余分な音も検出
  - 拍位置（小節・拍・裏拍）を推定テンポから算出
- 可視化：Canvas 波形（上下 2 段）＋オンセット線＋ズレ量ラベル、スコア、前ノリ/後ノリゲージ、レーダーチャート、ノートごとのズレ推移、改善アドバイス自動生成

## 構成

| パス | 役割 |
| --- | --- |
| `src/app/page.tsx` | ダッシュボード（状態管理・再生） |
| `src/lib/groove.ts` | オンセット検出・対応付け・スコア・アドバイス |
| `src/lib/audio.ts` | デコード・デモ生成・録音・再生 |
| `src/components/WaveformView.tsx` | Canvas 波形ビュー |
| `src/components/Insights.tsx` | スコア / ゲージ / レーダー / 推移 / アドバイス |
| `src/components/SourceSlot.tsx` | 音源読み込みエリア |
