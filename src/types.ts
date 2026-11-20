// ---------------------------------------------------------------- キャラクター
// character.json の形。ほかのアプリ(Notos など)も読むので、形を変えるときは
// CHARACTER_SCHEMA_VERSION を上げ、docs/character-format.md も直す。

export const CHARACTER_SCHEMA_VERSION = 1;

/** プロフィール。Notos の CharacterSheet と同じ名前の項目は、同じ意味で使う */
export interface Profile {
  name: string;
  reading: string;
  age: string;
  gender: string;
  role: string;
  personality: string;
  speech: string;
  background: string;
  notes: string;
}

/** 外見の項目。修正指示では、変わる項目だけを書き換える */
export const APPEARANCE_KEYS = ["hair", "eyes", "face", "skin", "height", "body", "outfit", "accessories", "other"] as const;
export type AppearanceKey = (typeof APPEARANCE_KEYS)[number];

export const APPEARANCE_LABEL: Record<AppearanceKey, string> = {
  hair: "髪",
  eyes: "目",
  face: "顔立ち",
  skin: "肌",
  height: "身長",
  body: "体型",
  outfit: "衣装",
  accessories: "小物",
  other: "その他",
};

/** 1項目の説明。ja は人が読んで直す文、en は生成に使う文 */
export interface AppearanceField {
  ja: string;
  en: string;
}

export type Appearance = Record<AppearanceKey, AppearanceField>;

/** 読み込んだ参照画像 */
export interface ReferenceImage {
  id: string;
  /** キャラクターのフォルダーの中の場所(refs/<id>.png など) */
  file: string;
  /** 元のファイル名 */
  label: string;
  /** 何を参考にするか */
  use: "all" | "face" | "outfit" | "style";
  addedAt: string;
}

export type ImageEngine = "moss" | "minimax_h3";

export const ENGINE_LABEL: Record<ImageEngine, string> = { moss: "MOSS-Image", minimax_h3: "MiniMax-H3-Image" };

/** 0〜1000 の [上, 左, 下, 右] */
export type Box1000 = [number, number, number, number];

/** 修正指示で変わった項目 */
export interface AppearanceChange {
  key: AppearanceKey;
  before: AppearanceField;
  after: AppearanceField;
}

/**
 * シートの版。1回の生成ごとに1つ増える。
 * 同じ画像を作り直したり、この版から分岐して直したりできるよう、生成に使ったものはすべて残す。
 */
export interface Revision {
  id: string;
  /** 元にした版(最初の版にはない) */
  parentId?: string;
  createdAt: string;
  /** create: 新規作成、instruction: 修正指示、redraw: 範囲の描き直し、manual: 説明を直接直した */
  kind: "create" | "instruction" | "redraw" | "manual";
  /** 修正指示の文(日本語) */
  instructionJa?: string;
  changes?: AppearanceChange[];
  /** この版の外見(版ごとに丸ごと残す) */
  appearance: Appearance;
  /** 生成に使ったプロンプトの全文 */
  prompt: string;
  negative: string;
  engine: ImageEngine;
  /** ComfyUI で使ったモデルのファイル */
  modelFiles: { unet: string; clip: string; vae: string; lora?: string };
  seed: number;
  width: number;
  height: number;
  /** fresh: 新しく描く、same_seed: 同じ seed で描き直す、reference: 元のシートを参照する、redraw: 範囲だけ描き直す */
  method: "fresh" | "same_seed" | "reference" | "redraw";
  /** 参照した画像(ReferenceImage の id。元のシートは "sheet:<版の id>") */
  references: string[];
  boxes?: Box1000[];
  /** ComfyUI に送ったワークフロー(API 形式) */
  workflow?: unknown;
  /** できた画像(sheets/<id>.png)。生成に失敗した版にはない */
  image?: string;
}

export interface Character {
  schemaVersion: number;
  app: "Euros";
  id: string;
  createdAt: string;
  updatedAt: string;
  profile: Profile;
  /** 最初に入力した日本語の説明 */
  sourceJa: string;
  /** 全体の画風(英語) */
  style: string;
  /** いまの外見(採用中の版の外見から、さらに直したもの) */
  appearance: Appearance;
  references: ReferenceImage[];
  revisions: Revision[];
  /** 採用中の版 */
  currentRevision?: string;
}

/** 一覧に出す分(Rust の summarize と同じ形) */
export interface CharacterSummary {
  id: string;
  name: string | null;
  reading: string | null;
  createdAt: string;
  updatedAt: string;
  revisionCount: number;
  sheet: string | null;
}

// ---------------------------------------------------------------- 設定

export interface ImageFiles {
  unet?: string;
  clip?: string;
  vae?: string;
}

export interface Settings {
  /** 画像生成に使う ComfyUI の URL */
  comfyUrl: string;
  imageEngine: ImageEngine;
  /** モデルごとの ComfyUI のファイル(空なら自動で選ぶ) */
  imageFiles?: Partial<Record<ImageEngine, ImageFiles>>;
  /** 日本語からプロンプトを作る Ollama */
  ollamaUrl: string;
  model: string;
  temperature: number;
  numCtx: number;
  /** キャラクターの保存先。空なら %APPDATA%\Euros\library */
  libraryDir: string;
}

export const DEFAULT_SETTINGS: Settings = {
  comfyUrl: "http://127.0.0.1:8188",
  imageEngine: "moss",
  ollamaUrl: "http://127.0.0.1:11434",
  model: "",
  temperature: 0.4,
  numCtx: 8192,
  libraryDir: "",
};
