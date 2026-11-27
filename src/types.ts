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
export const APPEARANCE_KEYS = ["hair", "eyes", "face", "skin", "height", "body", "outfit", "accessories", "equipment", "other"] as const;
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
  equipment: "装備品",
  other: "その他",
};

/** 1項目の説明。ja は人が読んで直す文、en は生成に使う文 */
export interface AppearanceField {
  ja: string;
  en: string;
}

/** 外見。equipment は v0.3.0 で足した項目なので、それより前のファイルにはない(読むときに空で補う) */
export type Appearance = Record<AppearanceKey, AppearanceField>;

/** 読み込んだ参照画像 */
export interface ReferenceImage {
  id: string;
  /** キャラクターのフォルダーの中の場所(refs/<id>.png など) */
  file: string;
  /** 元のファイル名 */
  label: string;
  /** 何を参考にするか */
  use: "all" | "face" | "outfit" | "equipment" | "style";
  addedAt: string;
}

/** 画像生成のモデル。中身は lib/comfy/engines.ts の ENGINES に登録する */
export type ImageEngine = "moss" | "minimax_h3";

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
  sheet: SheetOptions;
  revisions: Revision[];
  /** 採用中の版 */
  currentRevision?: string;
  /** 3D の目安(Boreas が読む)。v0.4.0 で足した項目なので、ないこともある */
  figure?: Figure;
}

// ---------------------------------------------------------------- 3D の目安
// Boreas が素体や形を作るための数値。どれも省略できる。読むときは lib/figure.ts の normalizeFigure で、おかしい値を捨てる。

/** 人物の体型(Boreas の素体の種類に対応する) */
export const BUILDS = ["slim", "standard", "sturdy"] as const;
export type Build = (typeof BUILDS)[number];
export const BUILD_LABEL: Record<Build, string> = { slim: "細身", standard: "標準", sturdy: "がっしり" };

/** 人ではない登場人物の形の種類 */
export const BODY_FORMS = ["sphere", "blob", "quadruped", "biped_monster", "object"] as const;
export type BodyForm = (typeof BODY_FORMS)[number];
export const BODY_FORM_LABEL: Record<BodyForm, string> = { sphere: "球", blob: "不定形", quadruped: "四足", biped_monster: "二足の怪物", object: "物" };

/** 人ではない登場人物の大きさ(m)。形の種類ごとに使う項目は BODY_SIZE_KEYS */
export interface BodySize {
  diameter?: number;
  width?: number;
  depth?: number;
  height?: number;
  length?: number;
}
export type BodySizeKey = keyof BodySize;
export const BODY_SIZE_KEYS: Record<BodyForm, BodySizeKey[]> = {
  sphere: ["diameter"],
  blob: ["width", "depth", "height"],
  quadruped: ["length", "height"],
  biped_monster: ["height", "width"],
  object: ["width", "depth", "height"],
};

export interface BodyShape {
  form: BodyForm;
  /** 単位は m */
  size: BodySize;
  /** 腕があるか(二足の怪物) */
  arms?: boolean;
  /** 尾があるか(四足・二足の怪物) */
  tail?: boolean;
}

export interface Figure {
  /** 人物の身長(cm) */
  heightCm?: number;
  /** 人物の体型 */
  build?: Build;
  /** 頭身 */
  heads?: number;
  /** 人ではない登場人物の形と大きさ */
  body?: BodyShape;
}

// ---------------------------------------------------------------- 衣装
// 登録した衣装(outfits/<id>/outfit.json)。ほかのキャラクターに着せるときに、説明と見本の画像を使う。
// 形を変えるときは OUTFIT_SCHEMA_VERSION を上げ、docs/character-format.md も直す。

export const OUTFIT_SCHEMA_VERSION = 1;

export interface Outfit {
  schemaVersion: number;
  app: "Euros";
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  /** 服装(キャラクターの外見の outfit と同じ書き方) */
  outfit: AppearanceField;
  /** 小物(キャラクターの外見の accessories と同じ書き方)。服装だけの衣装では空 */
  accessories: AppearanceField;
  /** 見本の画像(refs/<id>.png など)。ないこともある */
  image?: string;
  /** 登録元のキャラクターと版(キャラクターから登録したとき) */
  source?: { characterId: string; revisionId?: string };
}

// ---------------------------------------------------------------- 装備品
// 登録した装備品(equipment/<id>/equipment.json)。武器・盾・杖など、手に持つ物。
// キャラクターに持たせるときは、外見の equipment に説明を足すか入れ替え、見本の画像を参照画像として足す。
// 形を変えるときは EQUIPMENT_SCHEMA_VERSION を上げ、docs/character-format.md も直す。

export const EQUIPMENT_SCHEMA_VERSION = 1;

export const EQUIPMENT_CATEGORIES = ["weapon", "shield", "other"] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];
export const EQUIPMENT_CATEGORY_LABEL: Record<EquipmentCategory, string> = { weapon: "武器", shield: "盾", other: "そのほか" };

/** 3D の目安の型 */
export const EQUIPMENT_FORMS = ["rod", "blade", "box", "cylinder", "plate", "sphere"] as const;
export type EquipmentForm = (typeof EQUIPMENT_FORMS)[number];
export const EQUIPMENT_FORM_LABEL: Record<EquipmentForm, string> = { rod: "棒", blade: "刃物", box: "箱", cylinder: "円柱", plate: "板", sphere: "球" };

/** 装備品の寸法(cm)。型ごとに使う項目は EQUIPMENT_SIZE_KEYS */
export interface EquipmentSize {
  length?: number;
  width?: number;
  thickness?: number;
  diameter?: number;
  tipDiameter?: number;
  gripLength?: number;
}
export type EquipmentSizeKey = keyof EquipmentSize;
export const EQUIPMENT_SIZE_KEYS: Record<EquipmentForm, EquipmentSizeKey[]> = {
  rod: ["length", "diameter", "tipDiameter"],
  blade: ["length", "width", "thickness", "gripLength"],
  box: ["length", "width", "thickness"],
  cylinder: ["length", "diameter"],
  plate: ["length", "width", "thickness"],
  sphere: ["diameter"],
};

export interface Equipment {
  schemaVersion: number;
  app: "Euros";
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  category: EquipmentCategory;
  /** 見た目の説明(キャラクターの外見の equipment と同じ書き方) */
  description: AppearanceField;
  /** 見本の画像(refs/<id>.png など)。ないこともある */
  image?: string;
  /** 登録元のキャラクターと版(キャラクターから登録したとき) */
  source?: { characterId: string; revisionId?: string };
  /** 3D の目安の型(Boreas が読む)。v0.4.0 で足した項目なので、ないこともある */
  form?: EquipmentForm;
  /** 寸法(cm)。form とあわせて v0.4.0 で足した */
  size?: EquipmentSize;
}

/** 表情の1つ(ja は画面に出す名前、en は生成に使う説明) */
export interface Expression {
  ja: string;
  en: string;
}

/** シートの作り方 */
export interface SheetOptions {
  /** 表情一覧に並べる表情 */
  expressions: Expression[];
  /** 人ではない(ロボット・動物・物など)。人の姿にされないようにする */
  notHuman: boolean;
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
