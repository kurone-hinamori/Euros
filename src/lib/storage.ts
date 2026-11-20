import { invoke } from "@tauri-apps/api/core";
import type { Character, CharacterSummary, Settings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

export const listCharacters = () => invoke<CharacterSummary[]>("list_characters");
export const loadCharacter = (id: string) => invoke<Character>("load_character", { id });
export const saveCharacter = (character: Character) => invoke<void>("save_character", { character });
/** ライブラリの .trash に移す */
export const deleteCharacter = (id: string) => invoke<void>("delete_character", { id });

/** file は "sheets/<id>.png" や "refs/<id>.jpg" */
export const saveFile = (id: string, file: string, bytes: Uint8Array) => invoke<void>("save_file", bytes, { headers: { id, file } });
export const loadFile = async (id: string, file: string) => new Uint8Array(await invoke<ArrayBuffer>("load_file", { id, file }));
export const deleteFile = (id: string, file: string) => invoke<void>("delete_file", { id, file });

/** キャラクターを .euros(zip)に書き出す */
export const exportCharacter = (id: string, path: string) => invoke<void>("export_character", { id, path });

export type ImportResult = { status: "imported" | "exists"; id: string; name: string | null };
/** .euros を読み込む。同じ id があると mode なしでは "exists" を返す */
export const importCharacter = (path: string, mode?: "replace" | "copy", newId?: string) =>
  invoke<ImportResult>("import_character", { path, mode: mode ?? null, newId: newId ?? null });

export const libraryInfo =() => invoke<{ path: string; defaultPath: string }>("library_info");
export const openLibrary = () => invoke<void>("open_library");

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** 保存した画像を <img> で見せる URL にする(使い終わったら URL.revokeObjectURL) */
export async function fileUrl(id: string, file: string): Promise<string> {
  const bytes = await loadFile(id, file);
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
