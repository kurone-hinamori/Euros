import type { Appearance, AppearanceKey, Box1000, Expression, ReferenceImage, SheetOptions } from "../types";
import { APPEARANCE_KEYS } from "../types";
import { DEFAULT_NEGATIVE, type EngineDef } from "./comfy";

// キャラクターシートのプロンプト。1枚の中に、左に正面・横・背面の立ち姿、右上に表情一覧、右下に衣装と小物の詳細を置く。

/** シートの仕上がりの大きさ(3:2) */
export const SHEET_SIZE: [number, number] = [2304, 1536];

export const DEFAULT_EXPRESSIONS: Expression[] = [
  { ja: "通常", en: "neutral" },
  { ja: "笑顔", en: "gentle smile" },
  { ja: "大笑い", en: "laughing with mouth open" },
  { ja: "怒り", en: "angry" },
  { ja: "悲しみ", en: "sad with teary eyes" },
  { ja: "驚き", en: "surprised" },
];

export const DEFAULT_SHEET: SheetOptions = { expressions: DEFAULT_EXPRESSIONS, notHuman: false };

export const STYLE_PRESETS: { label: string; en: string }[] = [
  { label: "アニメ(セル塗り)", en: "Japanese anime style, clean thin line art, flat cel shading, soft natural colors" },
  { label: "アニメ(柔らかい塗り)", en: "Japanese anime illustration style, clean line art, soft gradient shading, gentle lighting" },
  { label: "セミリアル", en: "semi-realistic digital painting, detailed rendering, soft studio lighting" },
  { label: "デフォルメ", en: "cute chibi style with big head and small body, simple clean line art, flat colors" },
];

const EN_LABEL: Record<AppearanceKey, string> = {
  hair: "Hair",
  eyes: "Eyes",
  face: "Face",
  skin: "Skin",
  height: "Height",
  body: "Body",
  outfit: "Outfit",
  accessories: "Accessories",
  other: "Other",
};

const trimDot = (t: string) => t.trim().replace(/[.。]+$/, "");

/** 外見の説明(英語)。空の項目は除く */
export const appearanceText = (a: Appearance) =>
  APPEARANCE_KEYS.filter((k) => a[k].en.trim())
    .map((k) => `${EN_LABEL[k]}: ${trimDot(a[k].en)}.`)
    .join(" ");

/** 区画(0〜1000 の [上, 左, 下, 右]) */
const VIEWS: { box: Box1000; en: string }[] = [
  { box: [30, 10, 970, 200], en: "full-body front view, standing straight, arms relaxed" },
  { box: [30, 205, 970, 395], en: "full-body side view facing right, standing straight" },
  { box: [30, 400, 970, 590], en: "full-body back view, standing straight" },
];
const EXPRESSION_AREA: Box1000 = [30, 615, 540, 990];
const DETAIL_AREA: Box1000 = [570, 615, 970, 990];

/**
 * 衣装・小物の区画に描くもの。
 * 「衣装の部分の拡大図」とまとめて頼むと、服を切り取った布の断片のような絵になりやすかったので、
 * 人が着ていない衣装の全体と、単体の小物に分けて頼む
 */
function detailParts(
  a: Pick<Appearance, "outfit" | "accessories">,
  notHuman: boolean,
  area: Box1000 = DETAIL_AREA,
): { box: Box1000; caption: string; summary: string }[] {
  const outfit = trimDot(a.outfit.en);
  const acc = trimDot(a.accessories.en);
  const [y0, x0, y1, x1] = area;
  const split = Math.round(x0 + (x1 - x0) * 0.58);
  const outfitPart = {
    caption: notHuman
      ? `The character's worn items on their own, without the character, each drawn whole and uncropped: ${outfit}.`
      : `The complete outfit on its own, laid out flat with no person wearing it, every garment drawn whole and uncropped: ${outfit}.`,
    summary: `the complete outfit laid out flat without a person (${outfit})`,
  };
  const accPart = {
    caption: `The accessories drawn as whole standalone objects, uncropped, nobody holding them: ${acc}.`,
    summary: `the accessories as whole standalone objects (${acc})`,
  };
  if (outfit && acc)
    return [
      { box: [y0, x0, y1, split - 5], ...outfitPart },
      { box: [y0, split + 5, y1, x1], ...accPart },
    ];
  if (outfit) return [{ box: area, ...outfitPart }];
  if (acc) return [{ box: area, ...accPart }];
  return [];
}

/** 範囲を選ぶときの区画 */
export const SHEET_REGIONS: { label: string; box: Box1000 }[] = [
  { label: "正面", box: [0, 0, 1000, 202] },
  { label: "横", box: [0, 198, 1000, 398] },
  { label: "背面", box: [0, 394, 1000, 600] },
  { label: "表情一覧", box: [0, 600, 555, 1000] },
  { label: "衣装・小物", box: [555, 600, 1000, 1000] },
];

/** 表情の区画の列の数(3列に並べる) */
const gridCols = (n: number) => Math.min(3, Math.max(1, n));

/** 表情の区画の場所の英語(「top row, left」など)。並べ方は expressionBoxes と同じ */
function gridPlace(i: number, n: number): string {
  const cols = gridCols(n);
  const rows = Math.ceil(n / cols);
  const r = Math.floor(i / cols);
  const c = i % cols;
  const row = rows === 1 ? "" : rows === 2 ? ["top row", "bottom row"][r] : r === 0 ? "top row" : r === rows - 1 ? "bottom row" : rows === 3 ? "middle row" : `row ${r + 1}`;
  const col = cols === 1 ? "" : cols === 2 ? ["left", "right"][c] : ["left", "middle", "right"][c];
  return [row, col].filter(Boolean).join(", ");
}

/**
 * 表情の並び。並べた語だけを伝えると、どの顔がどの表情か分からず、隣の表情と混ざった。
 * 段ごとに、左から順に書く
 */
function expressionLayout(exps: string[]): string {
  const cols = gridCols(exps.length);
  const rows = Math.ceil(exps.length / cols);
  if (rows === 1) return `from left to right: ${exps.join("; ")}`;
  return Array.from({ length: rows }, (_, r) => {
    const name = gridPlace(r * cols, exps.length).split(",")[0];
    return `${name} from left to right: ${exps.slice(r * cols, (r + 1) * cols).join("; ")}`;
  }).join(". ");
}

/** 編集で表情を変えたときに伝える英語(変わった顔の場所と、前後の表情) */
export function expressionChanges(before: Expression[], after: Expression[]): string[] {
  const b = before.map((e) => trimDot(e.en));
  const a = after.map((e) => trimDot(e.en));
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  // 数が変わったら、並び全体を伝える
  if (a.length !== b.length) return [`the face grid now has ${a.length} close-ups, ${expressionLayout(a)}`];
  return a.flatMap((e, i) =>
    e === b[i] ? [] : [`the face close-up in the ${gridPlace(i, a.length)} of the face grid: change its expression from "${b[i]}" to "${e}", and keep the other faces as they are`],
  );
}

/** 表情の区画を3列に並べる */
function expressionBoxes(n: number): Box1000[] {
  const cols = gridCols(n);
  const rows = Math.ceil(n / cols);
  const [y0, x0, y1, x1] = EXPRESSION_AREA;
  const w = (x1 - x0) / cols;
  const h = (y1 - y0) / rows;
  return Array.from({ length: n }, (_, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return [Math.round(y0 + r * h + 4), Math.round(x0 + c * w + 4), Math.round(y0 + (r + 1) * h - 4), Math.round(x0 + (c + 1) * w - 4)] as Box1000;
  });
}

/** 0〜1000 の [上, 左, 下, 右] を、画像の中心を原点にした画素に直す(ComfyUI の MOSS-Image Layout Prompt と同じ) */
function pixelBox([y0, x0, y1, x1]: Box1000, width: number, height: number): number[] {
  const at = (v: number, size: number, round: (n: number) => number) => round(Math.round(((v * size) / 1000) * 1e9) / 1e9) - Math.floor(size / 2);
  return [at(y0, height, Math.floor), at(x0, width, Math.floor), at(y1, height, Math.ceil), at(x1, width, Math.ceil)];
}

const USE_EN: Record<ReferenceImage["use"], string> = {
  all: "shows this character. Keep the same face, hairstyle, outfit and colors",
  face: "is a reference for the face and hairstyle only",
  outfit: "is a reference for the outfit and accessories only",
  style: "is a reference for the art style only (line art and coloring). Do not copy its character or content",
};

/**
 * 参照画像の説明。MiniMax-H3-Image は <Picture n>、MOSS-Image は順番で伝える。
 * base があれば、1枚目はいまのシート(これを元に、変わる所だけ描き直す)
 */
function referenceLead(refs: Pick<ReferenceImage, "use">[], engine: EngineDef, base?: SheetInput["base"]): string {
  const total = refs.length + (base ? 1 : 0);
  if (!total) return "";
  const name = (i: number) => (engine.id === "minimax_h3" ? `<Picture ${i + 1}>` : total === 1 ? "The reference image" : `Reference image ${i + 1}`);
  const offset = base ? 1 : 0;
  const lines: string[] = [];
  if (base) {
    const changes = base.changes.map(trimDot).filter(Boolean);
    lines.push(
      `${name(0)} is the current version of this character design sheet. Redraw the same sheet: keep its layout, poses, art style, colors and every other detail exactly the same${
        changes.length ? `, and change only the following: ${changes.join("; ")}.` : "."
      }`,
    );
  }
  refs.forEach((r, i) => lines.push(`${name(i + offset)} ${USE_EN[r.use]}.`));
  if (refs.length) lines.push(`Do not copy the layout or background of the ${base ? "other " : ""}reference images.`);
  return lines.join(" ");
}

export interface SheetInput {
  style: string;
  appearance: Appearance;
  sheet: SheetOptions;
  /** 生成に使う参照画像(順番は ComfyUI に送る順。base があればその後ろ) */
  references: Pick<ReferenceImage, "use">[];
  /** いまのシートを1枚目に参照して直す。changes は変える所(英語)、keys は変わる外見の項目 */
  base?: { changes: string[]; keys?: AppearanceKey[] };
}

/** MOSS-Image でいまのシートを直すときの指示(公式テンプレートの書き方:Change only … Keep … unchanged.) */
function mossEditPrompt(input: SheetInput): string {
  const changes = (input.base?.changes ?? []).map(trimDot).filter(Boolean);
  const n = input.references.length;
  const exps = input.sheet.expressions.map((e) => trimDot(e.en)).filter(Boolean);
  // 区画を伝えないと、表情がそろったり、衣装・小物の区画が全身の絵に置き換わったりした
  const layout = [
    "the three full-body views on the left (front, side, back)",
    exps.length ? `the grid of ${exps.length} face close-ups at the top right, each with its own expression (${expressionLayout(exps)})` : "",
    "the outfit and accessories drawn on their own without the character at the bottom right",
  ].filter(Boolean);
  const name = (i: number) => `Reference image ${i + 1}`;
  return [
    // 1枚目はいつもいまのシート(ほかの参照画像がなくても伝える)
    `${name(0)} is the current character design sheet.`,
    changes.length
      ? `Change only the following on this character design sheet: ${changes.join("; ")}.`
      : "Redraw this character design sheet cleanly.",
    // 変える項目を「そのまま」にも書くと、指示が食い違って変わらなかった
    `Keep everything else exactly the same: ${[
      "the character",
      "face",
      "colors",
      ...(["outfit", "accessories"] as const).filter((k) => !input.base?.keys?.includes(k)),
      "poses",
      "art style",
      "white background",
    ].join(", ")} and the layout of the sheet.`,
    `The sheet has ${layout.join("; ")}. Keep each section as it is.`,
    ...input.references.map((r, i) => `${name(i + 1)} ${USE_EN[r.use]}.`),
    n ? "Do not copy the layout or background of the other reference images." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** シートのプロンプトの全文 */
export function sheetPrompt(input: SheetInput, engine: EngineDef): string {
  const { appearance: a, sheet } = input;
  const exps = sheet.expressions.filter((e) => e.en.trim());
  const who = sheet.notHuman ? "one and the same non-human character (not a human, draw it exactly as described, no people, no hands holding it)" : "one and the same character";
  const parts = detailParts(a, sheet.notHuman);
  const frame = [
    `Character design reference sheet on a plain white background, showing ${who}.`,
    `Left half: three full-body standing poses side by side at the same scale and height — front view, side view facing right, back view.`,
    exps.length
      ? `Top right: a grid of ${exps.length} head-and-shoulders close-ups of the same face, each with a different expression, ${expressionLayout(exps.map((e) => trimDot(e.en)))}.`
      : "",
    parts.length ? `Bottom right, without the character: ${parts.map((p) => p.summary).join(", and ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  // MOSS-Image の Edit LoRA は、変える所だけの短い指示で学習している。シート全体を書くと、
  // 文から描き直してしまい、参照したシートより色が薄くなった
  if (engine.id === "moss" && input.base) return mossEditPrompt(input);
  const summary = [
    referenceLead(input.references, engine, input.base),
    trimDot(input.style) ? `${trimDot(input.style)}.` : "",
    frame,
    `Character: ${appearanceText(a)}`,
    "Consistent design, colors and proportions in every view. Clean separation between sections with white space. No text, no labels, no captions, no borders.",
  ]
    .filter(Boolean)
    .join("\n");

  // 区画の位置を JSON レイアウトで伝えられるのは MOSS-Image だけ(参照するときは Edit 用の入力なので使わない)
  if (engine.id !== "moss" || input.references.length || input.base) return summary;
  const [w, h] = engine.drawSize(...SHEET_SIZE);
  const item = (box: Box1000, caption: string, label = "character") => ({ label, caption, bbox: pixelBox(box, w, h) });
  const items = [
    ...VIEWS.map((v) => item(v.box, `The character, ${v.en}.`)),
    ...expressionBoxes(exps.length).map((box, i) => item(box, `Head-and-shoulders close-up of the same character with this expression only: ${trimDot(exps[i].en)}.`)),
    ...parts.map((p) => item(p.box, `${p.caption} No people.`, "object")),
  ];
  return JSON.stringify({ summary: { caption: summary }, items, bbox_coord_space: "abs_centralized", bbox_format: "yxyx" });
}

/** シートの否定のプロンプト */
export function sheetNegative(sheet: SheetOptions): string {
  return [DEFAULT_NEGATIVE, "text, letters, labels, captions", sheet.notHuman ? "person, human, girl, boy, hands, holding" : ""].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------- 衣装だけの画像

/** 衣装の見本の画像の仕上がりの大きさ(4:3) */
export const OUTFIT_IMAGE_SIZE: [number, number] = [1536, 1152];

/**
 * 衣装の説明から、衣装の見本の画像(人が着ていない衣装と小物を、白地に並べた絵)を描くプロンプト。
 * シートの衣装・小物の区画と同じ描き方にする(この描き方で、着せるときの参照画像として使いやすかった)
 */
export function outfitImagePrompt(o: Pick<Appearance, "outfit" | "accessories">, style: string, engine: EngineDef): string {
  const parts = detailParts(o, false, [40, 30, 960, 970]);
  const summary = [
    trimDot(style) ? `${trimDot(style)}.` : "",
    `Costume design reference on a plain white background, without any person: ${parts.map((p) => p.summary).join(", and ")}.`,
    "Front view, every item drawn whole, uncropped and clearly separated with white space. No person, no mannequin, no body, no hands, no text, no labels, no borders.",
  ]
    .filter(Boolean)
    .join("\n");
  // 区画の位置を JSON レイアウトで伝えられるのは MOSS-Image だけ
  if (engine.id !== "moss") return summary;
  const [w, h] = engine.drawSize(...OUTFIT_IMAGE_SIZE);
  const items = parts.map((p) => ({ label: "object", caption: `${p.caption} No people.`, bbox: pixelBox(p.box, w, h) }));
  return JSON.stringify({ summary: { caption: summary }, items, bbox_coord_space: "abs_centralized", bbox_format: "yxyx" });
}

/** 衣装の見本の画像の否定のプロンプト */
export const outfitImageNegative = () => [DEFAULT_NEGATIVE, "person, human, girl, boy, mannequin, body, face, hands, text, letters, labels"].join(", ");
