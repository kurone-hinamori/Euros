import type { Appearance, AppearanceField, Equipment, EquipmentCategory } from "../types";
import { EQUIPMENT_SCHEMA_VERSION } from "../types";
import type { PendingReference } from "./character";
import { withEquipmentShape } from "./figure";
import { loadFile, newId, saveEquipment, saveFile } from "./storage";

// 登録した装備品。キャラクターに持たせるときは、外見の装備品(equipment)に説明を足すか入れ替え、
// 見本の画像を「装備品だけ」の参照画像として足す。

/** 持たせ方。add はいまの装備品に足す、replace はいまの装備品と持ち替える */
export type EquipMode = "add" | "replace";

const trimDot = (t: string) => t.trim().replace(/[.。、,;]+$/, "");

/** 見本の画像を入れ替える(null なら外す)。保存はしない */
export async function setEquipmentImage(e: Equipment, image: { bytes: Uint8Array; ext: string } | null): Promise<Equipment> {
  if (!image) return { ...e, image: undefined };
  const file = `refs/${newId()}.${image.ext}`;
  await saveFile(e.id, file, image.bytes, "equipment");
  return { ...e, image: file };
}

/** 装備品を新しく登録する */
export async function createEquipment(input: {
  name: string;
  category: EquipmentCategory;
  description: AppearanceField;
  image?: { bytes: Uint8Array; ext: string };
  source?: Equipment["source"];
  /** 3D の型と寸法 */
  shape?: Pick<Equipment, "form" | "size">;
}): Promise<Equipment> {
  const now = new Date().toISOString();
  const base: Equipment = withEquipmentShape({
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    app: "Euros",
    id: newId(),
    createdAt: now,
    updatedAt: now,
    name: input.name.trim() || "名前のない装備品",
    category: input.category,
    description: input.description,
    ...(input.source ? { source: input.source } : {}),
  }, input.shape ?? {});
  const e = await setEquipmentImage(base, input.image ?? null);
  await saveEquipment(e);
  return e;
}

/** 装備品の説明を、外見の装備品の欄にまとめる */
export function joinEquipment(items: Pick<Equipment, "description">[]): AppearanceField {
  return {
    ja: items.map((e) => trimDot(e.description.ja)).filter(Boolean).join("、"),
    en: items.map((e) => trimDot(e.description.en)).filter(Boolean).join("; "),
  };
}

/** 装備品を持たせた外見。すでに同じ説明を持っていれば changed は false */
export function equip(a: Appearance, e: Equipment, mode: EquipMode): { next: Appearance; changed: boolean } {
  const cur = a.equipment;
  const add = joinEquipment([e]);
  let field: AppearanceField;
  if (mode === "replace" || !cur.ja.trim()) field = add;
  else if (cur.ja.includes(add.ja)) field = cur;
  else field = { ja: `${trimDot(cur.ja)}、${add.ja}`, en: [trimDot(cur.en), add.en].filter(Boolean).join("; ") };
  const changed = field.ja !== cur.ja || field.en !== cur.en;
  return { next: { ...a, equipment: field }, changed };
}

/** 持たせたことを描き直しのプロンプトに伝える英語 */
export const equipSummaryEn = (e: Equipment, mode: EquipMode) =>
  mode === "replace" ? `change the handheld equipment to: ${trimDot(e.description.en)}` : `add this handheld equipment: ${trimDot(e.description.en)}`;

/** 装備品の見本の画像を、「装備品だけ」の参照画像にする(画像がなければ null) */
export async function equipmentReference(e: Equipment): Promise<PendingReference | null> {
  if (!e.image) return null;
  const bytes = await loadFile(e.id, e.image, "equipment");
  const ext = e.image.split(".").pop()!.toLowerCase();
  return { id: newId(), label: `装備品:${e.name}`, use: "equipment", ext, bytes };
}

/** キャラクターの名前から、装備品の名前の案を作る */
export const equipmentNameOf = (name: string) => `${name || "名前なし"}の装備品`;
