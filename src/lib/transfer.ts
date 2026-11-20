import { message, open, save } from "@tauri-apps/plugin-dialog";
import type { Character } from "../types";
import { exportCharacter, importCharacter, newId } from "./storage";

const FILTERS = [{ name: "Euros キャラクター", extensions: ["euros"] }];

/** ファイル名に使えない文字を除く */
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 60);

/** 保存先を選んで .euros に書き出す。書き出した場所(やめたら null)を返す */
export async function exportFlow(ch: Character): Promise<string | null> {
  const path = await save({ filters: FILTERS, defaultPath: `${safeName(ch.profile.name) || ch.id}.euros` });
  if (!path) return null;
  await exportCharacter(ch.id, path.toLowerCase().endsWith(".euros") ? path : `${path}.euros`);
  return path;
}

/** .euros を選んで読み込む。読み込んだキャラクターの id(やめたら null)を返す */
export async function importFlow(): Promise<string | null> {
  const path = await open({ filters: FILTERS, multiple: false, directory: false });
  if (!path) return null;
  const r = await importCharacter(path);
  if (r.status === "imported") return r.id;

  // 同じキャラクターがすでにある
  const labels = { yes: "置き換える", no: "別のキャラクターにする", cancel: "やめる" };
  const answer = await message(
    `「${r.name || "名前なし"}」はすでにあります。\n置き換えると、いまのキャラクターは保存先の .trash フォルダーに移します。`,
    { title: "読み込む", kind: "warning", buttons: labels },
  );
  const is = (key: "yes" | "no") => answer === labels[key] || answer === (key === "yes" ? "Yes" : "No");
  if (is("yes")) return (await importCharacter(path, "replace")).id;
  if (is("no")) return (await importCharacter(path, "copy", newId())).id;
  return null;
}
