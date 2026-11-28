/**
 * 楽器 × ジャンルのプロファイル。
 * 「何を基準に比べるか」をここで固定することで、比較の基準がぶれないようにする。
 */

export type InstrumentId = "drums" | "bass" | "guitar" | "piano" | "vocal";
export type GenreId = "funk" | "rock" | "jazz" | "pop" | "ballad";
export type FeatureId = "timing" | "velocity" | "attack" | "length" | "pitch";

export type Genre = {
  id: GenreId;
  label: string;
  /** 1 拍を何分割したグリッドで位置を数えるか（16分=4, 8分=2, 3連=3） */
  div: number;
  bpm: number;
  /** この ms 以内なら「タイト」とみなす（判定の物差し） */
  tightMs: number;
  groove: string;
};

export type DetectParams = {
  /** 立ち上がり判定用の包絡の窓（ms）。低音ほど長くする */
  envWinMs: number;
  minGapMs: number;
  riseDb: number;
  lagMs: number;
  /** アタックのピークを探す最大範囲（ms） */
  attackWinMs: number;
};

export type Instrument = {
  id: InstrumentId;
  label: string;
  short: string;
  genres: GenreId[];
  features: FeatureId[];
  weights: Partial<Record<FeatureId, number>>;
  detect: DetectParams;
  noun: string; // 「音」「打音」「声」など
  tips: Record<FeatureId, { plus: string; minus: string }>;
};

export const GENRES: Record<GenreId, Genre> = {
  funk: { id: "funk", label: "ファンク", div: 4, bpm: 100, tightMs: 10, groove: "16分のタイトなポケット。ゴーストノートとアクセントの強弱差がノリを作る" },
  rock: { id: "rock", label: "ロック", div: 2, bpm: 120, tightMs: 15, groove: "8分の推進力。2・4拍のバックビートを走らせず、太く鳴らす" },
  jazz: { id: "jazz", label: "ジャズ（スウィング）", div: 3, bpm: 120, tightMs: 20, groove: "3連のハネ（スウィング比）と、裏拍のアクセントでスウィングする" },
  pop: { id: "pop", label: "ポップス", div: 2, bpm: 90, tightMs: 15, groove: "歌詞が立つ明快なリズム。フレーズの頭を揃え、語尾まで音を保つ" },
  ballad: { id: "ballad", label: "バラード", div: 2, bpm: 70, tightMs: 25, groove: "ゆったりとしたタメ。音の長さと抑揚で感情を運ぶ" },
};

export const FEATURE_LABEL: Record<FeatureId, string> = {
  timing: "タイミング",
  velocity: "強弱",
  attack: "アタック",
  length: "音の長さ",
  pitch: "ピッチ",
};

export const FEATURE_UNIT: Record<FeatureId, string> = {
  timing: "ms",
  velocity: "dB",
  attack: "ms",
  length: "ms",
  pitch: "cent",
};

export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  drums: {
    id: "drums",
    label: "ドラム",
    short: "Dr",
    genres: ["funk", "rock"],
    features: ["timing", "velocity", "attack", "length"],
    weights: { timing: 0.5, velocity: 0.3, attack: 0.05, length: 0.15 },
    detect: { envWinMs: 5, minGapMs: 50, riseDb: 6, lagMs: 10, attackWinMs: 30 },
    noun: "打音",
    tips: {
      timing: { minus: "その拍の直前で一瞬「待つ」意識を。スティックを振り上げる高さを揃えると突っ込みにくくなります", plus: "振り下ろしの準備を早めましょう。手首だけでなく前の音から次の動作を始めます" },
      velocity: { minus: "アクセントをもっと強く。スティックを高く上げ、重さで落とすイメージで", plus: "ゴーストノートが強すぎます。スティックの高さを2〜3cmに抑え、「置く」ように叩きます" },
      attack: { minus: "", plus: "打点がぼやけています。ヘッドに当てた後すぐにスティックを跳ね返らせましょう" },
      length: { minus: "音が詰まっています。叩いた後にスティックをヘッドに押し付けないように", plus: "余韻が長すぎます。ハイハットをしっかり閉じ、クローズの音を短く切りましょう" },
      pitch: { minus: "", plus: "" },
    },
  },
  bass: {
    id: "bass",
    label: "ベース",
    short: "Ba",
    genres: ["funk", "rock"],
    features: ["timing", "velocity", "attack", "length"],
    weights: { timing: 0.45, velocity: 0.2, attack: 0.1, length: 0.25 },
    detect: { envWinMs: 14, minGapMs: 70, riseDb: 6, lagMs: 12, attackWinMs: 50 },
    noun: "音",
    tips: {
      timing: { minus: "ドラムのキックを聴いてから弾くくらいの気持ちで、ほんの少し後ろへ", plus: "左手の押弦を早めに準備し、右手の発音を前に詰めましょう" },
      velocity: { minus: "アクセントの音をもっと深く弾きましょう", plus: "強弱の差が小さく平坦です。裏の音を軽く、表を太く弾き分けます" },
      attack: { minus: "", plus: "立ち上がりが遅いです。指の腹ではなく指先寄りで弦を弾き、芯を出しましょう" },
      length: { minus: "音を切るのが早すぎます。左手のミュートをあと一瞬遅らせて、音価を保ちます", plus: "音が伸びすぎています。次の音の直前で左手を浮かせてミュートします" },
      pitch: { minus: "", plus: "" },
    },
  },
  guitar: {
    id: "guitar",
    label: "ギター",
    short: "Gt",
    genres: ["funk", "rock"],
    features: ["timing", "velocity", "attack", "length"],
    weights: { timing: 0.45, velocity: 0.25, attack: 0.15, length: 0.15 },
    detect: { envWinMs: 6, minGapMs: 55, riseDb: 5, lagMs: 10, attackWinMs: 35 },
    noun: "音",
    tips: {
      timing: { minus: "右手の振りを止めずに、空ピッキングで16分のテンポを体に保ちましょう", plus: "右手の振り子がテンポより遅れています。肘から一定に振り続けます" },
      velocity: { minus: "アクセントのカッティングをもっと強く", plus: "ミュート音（空ピッキング）が大きすぎます。左手の脱力を深くしましょう" },
      attack: { minus: "", plus: "ピッキングが弦に当たる角度が深く、立ち上がりが鈍いです。ピックを浅く当てます" },
      length: { minus: "コードを切るのが早いです。左手を緩めるタイミングを遅らせましょう", plus: "カッティングの音が伸びています。弾いた直後に左手を緩めて歯切れよく" },
      pitch: { minus: "", plus: "" },
    },
  },
  piano: {
    id: "piano",
    label: "ピアノ",
    short: "Pf",
    genres: ["jazz", "pop"],
    features: ["timing", "velocity", "attack", "length"],
    weights: { timing: 0.4, velocity: 0.3, attack: 0.1, length: 0.2 },
    detect: { envWinMs: 25, minGapMs: 80, riseDb: 4, lagMs: 15, attackWinMs: 60 },
    noun: "打鍵",
    tips: {
      timing: { minus: "裏拍を急がず、3連の3つ目まで待ってから弾きましょう", plus: "打鍵の準備が遅れています。指を鍵盤の上に先回りさせます" },
      velocity: { minus: "アクセントの打鍵をもう少し深く", plus: "全部の音が同じ強さです。裏拍のアクセントと表拍の軽さで抑揚を付けます" },
      attack: { minus: "", plus: "打鍵の立ち上がりが鈍いです。指先を立て、鍵盤の底まで素早く届かせます" },
      length: { minus: "音を切るのが早いです。指を鍵盤から離すのを遅らせ、レガートに", plus: "音が伸びすぎています。スタッカートの音は指を素早く離しましょう" },
      pitch: { minus: "", plus: "" },
    },
  },
  vocal: {
    id: "vocal",
    label: "ボーカル",
    short: "Vo",
    genres: ["pop", "ballad"],
    features: ["timing", "velocity", "attack", "length", "pitch"],
    weights: { timing: 0.3, velocity: 0.15, attack: 0.1, length: 0.15, pitch: 0.3 },
    detect: { envWinMs: 12, minGapMs: 120, riseDb: 6, lagMs: 30, attackWinMs: 160 },
    noun: "声",
    tips: {
      timing: { minus: "歌い出しを急いでいます。ブレスを早めに取り、拍を感じてから声を出しましょう", plus: "歌い出しが遅れています。子音を拍より少し前に置くと、母音が拍に乗ります" },
      velocity: { minus: "盛り上がる音でもっと息を流しましょう", plus: "抑揚が少なく平坦です。フレーズの頂点に向けて音量を上げていきます" },
      attack: { minus: "", plus: "声の立ち上がりが遅いです。息を先に流してから声帯を合わせる「気息的な発声」になっていないか確認を" },
      length: { minus: "語尾を切るのが早いです。最後の母音を拍の終わりまで保ちましょう", plus: "音が次のフレーズにかかっています。語尾の処理を少し早めに" },
      pitch: { minus: "音程が低め（フラット）です。高い音ほど目線を上げ、息のスピードを保ちましょう", plus: "音程が高め（シャープ）です。喉に力が入っていないか確認しましょう" },
    },
  },
};

export const INSTRUMENT_ORDER: InstrumentId[] = ["drums", "bass", "guitar", "piano", "vocal"];

/** 拍内の位置ラベル */
export function subLabel(div: number, sub: number): string {
  if (sub === 0) return "";
  if (div === 4) return ["", "の16分ウラ(e)", "のウラ(&)", "の16分ウラ(a)"][sub] ?? "";
  if (div === 3) return ["", "の3連2つ目", "のウラ(3連)"][sub] ?? "";
  return "のウラ";
}
