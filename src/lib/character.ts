import type { Appearance, Character, ImageEngine, Profile, ReferenceImage, Revision, SheetOptions } from "../types";
import { APPEARANCE_KEYS, CHARACTER_SCHEMA_VERSION } from "../types";
import type { ComfyModels, Graph } from "./comfy";
import { newId, saveCharacter, saveFile } from "./storage";

export const emptyProfile = (): Profile => ({ name: "", reading: "", age: "", gender: "", role: "", personality: "", speech: "", background: "", notes: "" });

export const emptyAppearance = (): Appearance => Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, { ja: "", en: "" }])) as Appearance;

export const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

/** 読み込んだまま、まだ保存していない参照画像 */
export interface PendingReference {
  id: string;
  label: string;
  use: ReferenceImage["use"];
  ext: string;
  bytes: Uint8Array;
}

/** ファイル(ドラッグ&ドロップや選択)から参照画像を作る */
export async function readReference(file: File): Promise<PendingReference> {
  const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
  if (!["png", "jpg", "jpeg", "webp"].includes(ext)) throw new Error(`${file.name}:PNG・JPEG・WebP の画像を選んでください`);
  return { id: newId(), label: file.name, use: "all", ext, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** ComfyUI に送るときの名前(同じ名前は上書きされるので、id を入れる) */
export const comfyName = (r: { id: string; ext: string }) => `${r.id}.${r.ext}`;

/** 生成した1枚(採用するまでは候補として持つ) */
export interface Candidate {
  png: Uint8Array;
  /** 描いたときの外見 */
  appearance: Appearance;
  prompt: string;
  negative: string;
  engine: ImageEngine;
  models: ComfyModels;
  seed: number;
  width: number;
  height: number;
  references: string[];
  workflow: Graph;
  createdAt: string;
}

/** 候補から版を作る */
export function revisionOf(c: Candidate, kind: Revision["kind"], extra: Partial<Revision> = {}): Revision {
  const id = newId();
  return {
    id,
    createdAt: c.createdAt,
    kind,
    appearance: structuredClone(c.appearance),
    prompt: c.prompt,
    negative: c.negative,
    engine: c.engine,
    modelFiles: { unet: c.models.unet, clip: c.models.clip, vae: c.models.vae, ...(c.models.lora && c.references.length ? { lora: c.models.lora } : {}) },
    seed: c.seed,
    width: c.width,
    height: c.height,
    method: "fresh",
    references: c.references,
    workflow: c.workflow,
    image: `sheets/${id}.png`,
    ...extra,
  };
}

/** 新しいキャラクターを保存する(参照画像、シート、character.json の順) */
export async function createCharacter(input: {
  profile: Profile;
  sourceJa: string;
  style: string;
  sheet: SheetOptions;
  references: PendingReference[];
  chosen: Candidate;
}): Promise<Character> {
  const id = newId();
  const now = new Date().toISOString();
  const references = await storeReferences(id, input.references);
  const rev = revisionOf(input.chosen, "create");
  await saveFile(id, rev.image!, input.chosen.png);
  const character: Character = {
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    app: "Euros",
    id,
    createdAt: now,
    updatedAt: now,
    profile: input.profile,
    sourceJa: input.sourceJa,
    style: input.style,
    appearance: structuredClone(input.chosen.appearance),
    references,
    sheet: input.sheet,
    revisions: [rev],
    currentRevision: rev.id,
  };
  await saveCharacter(character);
  return character;
}

/** 読み込んだ参照画像を保存し、キャラクターの参照画像にする */
export async function storeReferences(characterId: string, refs: PendingReference[]): Promise<ReferenceImage[]> {
  const now = new Date().toISOString();
  const out: ReferenceImage[] = [];
  for (const r of refs) {
    const file = `refs/${r.id}.${r.ext}`;
    await saveFile(characterId, file, r.bytes);
    out.push({ id: r.id, file, label: r.label, use: r.use, addedAt: now });
  }
  return out;
}

/** 候補を新しい版として加え、採用して保存する */
export async function addRevision(ch: Character, c: Candidate, extra: Partial<Revision> & Pick<Revision, "kind">): Promise<Character> {
  const rev = revisionOf(c, extra.kind, extra);
  await saveFile(ch.id, rev.image!, c.png);
  const next: Character = {
    ...ch,
    updatedAt: new Date().toISOString(),
    appearance: structuredClone(c.appearance),
    revisions: [...ch.revisions, rev],
    currentRevision: rev.id,
  };
  await saveCharacter(next);
  return next;
}
