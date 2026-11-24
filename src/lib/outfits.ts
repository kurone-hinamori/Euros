import type { Appearance, AppearanceField, AppearanceKey, Box1000, Character, Outfit } from "../types";
import { OUTFIT_SCHEMA_VERSION } from "../types";
import type { PendingReference } from "./character";
import { emptyAppearance } from "./character";
import { loadFile, newId, saveFile, saveOutfit } from "./storage";

// 登録した衣装。ほかのキャラクターに着せるときは、外見の衣装・小物を書き換え、
// 見本の画像を「衣装と小物だけ」の参照画像として足す。

/** 衣装が書き換える外見の項目 */
export const OUTFIT_KEYS = ["outfit", "accessories"] as const satisfies readonly AppearanceKey[];

const hasText = (f: AppearanceField) => !!(f.ja.trim() || f.en.trim());

/** 画像の一部(0〜1000 の [上, 左, 下, 右])を切り出して PNG にする */
export async function cropImage(bytes: Uint8Array, [y0, x0, y1, x1]: Box1000): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  const sx = Math.round((x0 * bmp.width) / 1000);
  const sy = Math.round((y0 * bmp.height) / 1000);
  const w = Math.max(1, Math.round((x1 * bmp.width) / 1000) - sx);
  const h = Math.max(1, Math.round((y1 * bmp.height) / 1000) - sy);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, sx, sy, w, h, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
  if (!blob) throw new Error("画像を切り出せませんでした");
  return new Uint8Array(await blob.arrayBuffer());
}

/** 見本の画像を入れ替える(null なら外す)。保存はしない */
export async function setOutfitImage(o: Outfit, image: { bytes: Uint8Array; ext: string } | null): Promise<Outfit> {
  if (!image) return { ...o, image: undefined };
  const file = `refs/${newId()}.${image.ext}`;
  await saveFile(o.id, file, image.bytes, "outfits");
  return { ...o, image: file };
}

/** 衣装を新しく登録する */
export async function createOutfit(input: {
  name: string;
  outfit: AppearanceField;
  accessories: AppearanceField;
  image?: { bytes: Uint8Array; ext: string };
  source?: Outfit["source"];
}): Promise<Outfit> {
  const now = new Date().toISOString();
  const base: Outfit = {
    schemaVersion: OUTFIT_SCHEMA_VERSION,
    app: "Euros",
    id: newId(),
    createdAt: now,
    updatedAt: now,
    name: input.name.trim() || "名前のない衣装",
    outfit: input.outfit,
    accessories: input.accessories,
    ...(input.source ? { source: input.source } : {}),
  };
  const o = await setOutfitImage(base, input.image ?? null);
  await saveOutfit(o);
  return o;
}

/** キャラクターの名前から、衣装の名前の案を作る */
export const outfitNameOf = (ch: Character) => `${ch.profile.name || "名前なし"}の衣装`;

/** 衣装の項目だけを入れた外見(外見の編集の部品で直すため) */
export const outfitAppearance = (o: Pick<Outfit, "outfit" | "accessories">): Appearance => ({ ...emptyAppearance(), outfit: o.outfit, accessories: o.accessories });

/**
 * 衣装を着せた外見。説明のある項目だけを書き換える
 * (小物のない衣装なら、キャラクターの小物はそのまま残す)
 */
export function wearOutfit(a: Appearance, o: Outfit): { next: Appearance; keys: AppearanceKey[] } {
  const keys = OUTFIT_KEYS.filter((k) => hasText(o[k]) && (o[k].ja !== a[k].ja || o[k].en !== a[k].en));
  const next = { ...a };
  for (const k of keys) next[k] = { ...o[k] };
  return { next, keys };
}

/** 衣装の見本の画像を、「衣装と小物だけ」の参照画像にする(画像がなければ null) */
export async function outfitReference(o: Outfit): Promise<PendingReference | null> {
  if (!o.image) return null;
  const bytes = await loadFile(o.id, o.image, "outfits");
  const ext = o.image.split(".").pop()!.toLowerCase();
  return { id: newId(), label: `衣装:${o.name}`, use: "outfit", ext, bytes };
}

/** 着替えを描き直しのプロンプトに伝える英語 */
export const wearSummaryEn = (o: Outfit, keys: AppearanceKey[]) =>
  keys.map((k) => (k === "outfit" ? `change the outfit to: ${o.outfit.en.trim()}` : `change the accessories to: ${o.accessories.en.trim()}`)).join("; ");
