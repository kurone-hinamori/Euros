import type { BodyShape, BodySize, BodySizeKey, Equipment, EquipmentSize, EquipmentSizeKey, Figure } from "../types";
import { BODY_FORMS, BODY_FORM_LABEL, BODY_SIZE_KEYS, BUILDS, BUILD_LABEL, EQUIPMENT_FORMS, EQUIPMENT_FORM_LABEL, EQUIPMENT_SIZE_KEYS } from "../types";

// 3D の目安(Boreas が読む数値)。どれも省略できるので、読むときと保存するときに、おかしい値と空の項目を落とす。

export const BODY_SIZE_LABEL: Record<BodySizeKey, string> = { diameter: "直径", width: "幅", depth: "奥行き", height: "高さ", length: "体長" };
export const EQUIPMENT_SIZE_LABEL: Record<EquipmentSizeKey, string> = {
  length: "長さ",
  width: "幅",
  thickness: "厚さ",
  diameter: "太さ(直径)",
  tipDiameter: "先の太さ",
  gripLength: "柄の長さ",
};

/** 0 より大きく max 以下の数だけを通す */
const positive = (v: unknown, max: number): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? v : undefined);

const pick = <K extends string>(src: unknown, keys: readonly K[], max: number): Partial<Record<K, number>> => {
  const out: Partial<Record<K, number>> = {};
  if (!src || typeof src !== "object") return out;
  for (const k of keys) {
    const v = positive((src as Record<string, unknown>)[k], max);
    if (v !== undefined) out[k] = v;
  }
  return out;
};

const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (list.includes(v as T) ? (v as T) : undefined);

/** 人ではない登場人物の形。形の種類が分からなければ捨てる。大きさは、その種類で使う項目だけを残す */
export function normalizeBody(b: unknown): BodyShape | undefined {
  if (!b || typeof b !== "object") return undefined;
  const o = b as Record<string, unknown>;
  const form = oneOf(o.form, BODY_FORMS);
  if (!form) return undefined;
  const size: BodySize = pick(o.size, BODY_SIZE_KEYS[form], 1000);
  const out: BodyShape = { form, size };
  if (typeof o.arms === "boolean" && form === "biped_monster") out.arms = o.arms;
  if (typeof o.tail === "boolean" && (form === "biped_monster" || form === "quadruped")) out.tail = o.tail;
  return out;
}

/** 3D の目安。空になれば undefined(character.json に書かない) */
export function normalizeFigure(f: unknown): Figure | undefined {
  if (!f || typeof f !== "object") return undefined;
  const o = f as Record<string, unknown>;
  const out: Figure = {};
  const heightCm = positive(o.heightCm, 1000);
  if (heightCm !== undefined) out.heightCm = heightCm;
  const build = oneOf(o.build, BUILDS);
  if (build) out.build = build;
  const heads = positive(o.heads, 12);
  if (heads !== undefined && heads >= 1) out.heads = heads;
  const body = normalizeBody(o.body);
  if (body) out.body = body;
  return Object.keys(out).length ? out : undefined;
}

/** 装備品の型と寸法。型が分からなければ両方とも捨てる。寸法は、その型で使う項目だけを残す */
export function normalizeEquipmentShape(e: Pick<Equipment, "form" | "size">): Pick<Equipment, "form" | "size"> {
  const form = oneOf(e.form, EQUIPMENT_FORMS);
  if (!form) return {};
  const size: EquipmentSize = pick(e.size, EQUIPMENT_SIZE_KEYS[form], 10000);
  return { form, size };
}

/** 装備品の型と寸法を置き換える(undefined の項目は消す) */
export function withEquipmentShape<T extends Equipment>(e: T, shape: Pick<Equipment, "form" | "size">): T {
  const { form: _f, size: _s, ...rest } = e;
  return { ...rest, ...normalizeEquipmentShape(shape) } as T;
}

/** 入力欄の文字を数にする(空や数でないときは undefined) */
export const parseNumber = (t: string): number | undefined => {
  const v = Number(t.trim());
  return t.trim() && Number.isFinite(v) ? v : undefined;
};

/** 3D の目安を一行で見せる(なければ空) */
export function figureText(f: Figure | undefined, notHuman: boolean): string {
  if (!f) return "";
  if (notHuman) {
    const b = f.body;
    if (!b) return "";
    const size = BODY_SIZE_KEYS[b.form].filter((k) => b.size[k] !== undefined).map((k) => `${BODY_SIZE_LABEL[k]} ${b.size[k]}m`);
    return [BODY_FORM_LABEL[b.form], ...size].join(" · ");
  }
  return [f.heightCm !== undefined && `身長 ${f.heightCm}cm`, f.build && BUILD_LABEL[f.build], f.heads !== undefined && `${f.heads}頭身`].filter(Boolean).join(" · ");
}

/** 装備品の型と寸法を一行で見せる(なければ空) */
export function equipmentShapeText(e: Pick<Equipment, "form" | "size">): string {
  if (!e.form) return "";
  const size = EQUIPMENT_SIZE_KEYS[e.form].filter((k) => e.size?.[k] !== undefined).map((k) => `${EQUIPMENT_SIZE_LABEL[k]} ${e.size![k]}cm`);
  return [EQUIPMENT_FORM_LABEL[e.form], ...size].join(" · ");
}
