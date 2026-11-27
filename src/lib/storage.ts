import { invoke } from "@tauri-apps/api/core";
import type { Appearance, Character, CharacterSummary, Equipment, Outfit, Settings } from "../types";
import { APPEARANCE_KEYS, DEFAULT_SETTINGS } from "../types";
import { normalizeFigure, withEquipmentShape } from "./figure";

export const listCharacters = () => invoke<CharacterSummary[]>("list_characters");
/** 前の版にない外見の項目(v0.3.0 の装備品など)を、空で補う */
const fillAppearance = (a: Partial<Appearance> | undefined): Appearance =>
  Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, { ja: a?.[k]?.ja ?? "", en: a?.[k]?.en ?? "" }])) as Appearance;

export const loadCharacter = async (id: string) => {
  const c = await invoke<Character>("load_character", { id });
  return {
    ...c,
    appearance: fillAppearance(c.appearance),
    revisions: c.revisions.map((r) => ({ ...r, appearance: fillAppearance(r.appearance) })),
    figure: normalizeFigure(c.figure),
  };
};
export const saveCharacter = (character: Character) => invoke<void>("save_character", { character });
/** ライブラリの .trash に移す */
export const deleteCharacter = (id: string) => invoke<void>("delete_character", { id });

/** キャラクターか、登録した衣装か装備品か */
export type Kind = "characters" | "outfits" | "equipment";

/** file は "sheets/<id>.png" や "refs/<id>.jpg" */
export const saveFile = (id: string, file: string, bytes: Uint8Array, kind: Kind = "characters") => invoke<void>("save_file", bytes, { headers: { id, file, kind } });
export const loadFile = async (id: string, file: string, kind: Kind = "characters") => new Uint8Array(await invoke<ArrayBuffer>("load_file", { id, file, kind }));
export const deleteFile = (id: string, file: string, kind: Kind = "characters") => invoke<void>("delete_file", { id, file, kind });

export const listOutfits = () => invoke<Outfit[]>("list_outfits");
export const saveOutfit = (outfit: Outfit) => invoke<void>("save_outfit", { outfit });
/** ライブラリの .trash に移す */
export const deleteOutfit = (id: string) => invoke<void>("delete_outfit", { id });

/** 型と寸法(v0.4.0 で足した)は、おかしい値を落として読む */
export const listEquipment = async () => {
  const list = await invoke<Equipment[]>("list_equipment");
  return list.map((e) => withEquipmentShape(e, e));
};
export const saveEquipment = (equipment: Equipment) => invoke<void>("save_equipment", { equipment });
/** ライブラリの .trash に移す */
export const deleteEquipment = (id: string) => invoke<void>("delete_equipment", { id });

/** キャラクターを .euros(zip)に書き出す */
export const exportCharacter = (id: string, path: string) => invoke<void>("export_character", { id, path });

export type ImportResult = { status: "imported" | "exists"; id: string; name: string | null };
/** .euros を読み込む。同じ id があると mode なしでは "exists" を返す */
export const importCharacter = (path: string, mode?: "replace" | "copy", newId?: string) =>
  invoke<ImportResult>("import_character", { path, mode: mode ?? null, newId: newId ?? null });

export const libraryInfo = () => invoke<{ path: string; defaultPath: string }>("library_info");
export const openLibrary = () => invoke<void>("open_library");

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** 保存した画像を <img> で見せる URL にする(使い終わったら URL.revokeObjectURL) */
export async function fileUrl(id: string, file: string, kind: Kind = "characters"): Promise<string> {
  const bytes = await loadFile(id, file, kind);
  const ext = file.split(".").pop()?.toLowerCase() ?? "png";
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[ext] ?? "image/png" }));
}

/** アプリのデータフォルダーの settings.json から読む */
export async function loadSettings(): Promise<Settings> {
  try {
    const saved = await invoke<Partial<Settings> | null>("load_settings");
    return { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const saveSettings = (s: Settings) => invoke<void>("save_settings", { settings: s });
