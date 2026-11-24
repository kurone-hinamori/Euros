import { fetch } from "@tauri-apps/plugin-http";
import type { ImageEngine, Settings } from "../../types";
import { type ComfyModels, type FileKind, type ImageRequest, type UploadedRequest, engineOf, FILE_KINDS } from "./engines";
import { type Graph, type Link, redrawComposite } from "./graph";

type Url = Pick<Settings, "comfyUrl">;
type Conn = Pick<Settings, "comfyUrl" | "imageEngine" | "imageFiles">;

const base = (s: Url) => s.comfyUrl.replace(/\/+$/, "");

/** ComfyUI は Origin ヘッダーを検査するので、ComfyUI 自身のオリジンを名乗る */
function headers(s: Url): Record<string, string> {
  try {
    return { "Content-Type": "application/json", Origin: new URL(base(s)).origin };
  } catch {
    return { "Content-Type": "application/json" };
  }
}

async function getJson<T>(s: Url, path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${base(s)}${path}`, { headers: headers(s), signal });
  if (!res.ok) throw new Error(`ComfyUI エラー ${res.status}`);
  return (await res.json()) as T;
}

const post = (s: Url, path: string, body: unknown) => fetch(`${base(s)}${path}`, { method: "POST", headers: headers(s), body: JSON.stringify(body) });

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

// ---------------------------------------------------------------- 接続とモデル

export interface ComfyStats {
  version: string;
  devices: { name: string; vram_total: number; vram_free: number }[];
}

/** 接続の確認。ComfyUI のバージョンと GPU を返す */
export async function comfyStats(s: Url): Promise<ComfyStats> {
  const data = await getJson<{ system?: { comfyui_version?: string }; devices?: ComfyStats["devices"] }>(s, "/system_stats");
  return { version: data.system?.comfyui_version ?? "不明", devices: data.devices ?? [] };
}

async function modelsOf(s: Url, node: string, input: string): Promise<string[]> {
  const info = await getJson<Record<string, { input: { required: Record<string, unknown[]> } }>>(s, `/object_info/${node}`);
  const spec = info[node]?.input.required[input] ?? [];
  if (Array.isArray(spec[0])) return spec[0] as string[];
  return ((spec[1] as { options?: string[] } | undefined)?.options ?? []) as string[];
}

/** ComfyUI にあるモデルのファイルの一覧(設定で選ぶため) */
export async function comfyFileLists(s: Url): Promise<Record<FileKind, string[]>> {
  const [unet, clip, vae] = await Promise.all([modelsOf(s, "UNETLoader", "unet_name"), modelsOf(s, "CLIPLoader", "clip_name"), modelsOf(s, "VAELoader", "vae_name")]);
  return { unet, clip, vae };
}

/** 「自動」で選ぶファイル */
export const autoFile = (engine: ImageEngine, kind: FileKind, list: string[]) =>
  engineOf(engine).files[kind].prefixes.map((p) => list.find((m) => m.startsWith(p))).find(Boolean);

/** 設定で選んだモデルに必要なファイルを探す。足りないときは、足りないファイルを示すエラーにする */
export async function detectComfy(s: Conn): Promise<ComfyModels> {
  const def = engineOf(s.imageEngine);
  const [lists, upscales, loras] = await Promise.all([
    comfyFileLists(s),
    modelsOf(s, "UpscaleModelLoader", "model_name").catch(() => [] as string[]),
    modelsOf(s, "LoraLoaderModelOnly", "lora_name").catch(() => [] as string[]),
  ]);
  const own = s.imageFiles?.[def.id] ?? {};
  const pick = (k: FileKind) => (own[k] ? lists[k].find((m) => m === own[k]) : autoFile(def.id, k, lists[k]));
  const missing = FILE_KINDS.flatMap((k) => (pick(k) ? [] : [own[k] ? `${own[k]}(設定で選んだファイル)` : def.files[k].need]));
  if (missing.length) throw new Error(`${def.label} のモデルが見つかりません:${missing.join("、")}`);
  return {
    engine: def.id,
    unet: pick("unet")!,
    clip: pick("clip")!,
    vae: pick("vae")!,
    upscale: upscales.find((m) => /anime/i.test(m)) ?? upscales[0],
    lora: def.findLora?.(loras),
  };
}

// ---------------------------------------------------------------- ワークフロー

const SAVE_NODE = "save";

/** ComfyUI の API 形式のワークフロー全体 */
export function comfyWorkflow(m: ComfyModels, r: UploadedRequest): Graph {
  const def = engineOf(m.engine);
  const size = def.drawSize(r.width, r.height, r.references.length > 0 && def.canReference(m));
  const g: Graph = {};
  let image: Link = def.build(g, m, r, size);
  const [w, h] = [r.width, r.height];
  if (size[0] !== w || size[1] !== h) {
    const up = size[0] < w || size[1] < h;
    // 拡大のモデル(多くは4倍)は時間がかかるので、2倍以上に拡大するときだけ使う
    const useModel = up && !!m.upscale && Math.max(w / size[0], h / size[1]) >= 2;
    if (useModel) {
      g.upscaler = { class_type: "UpscaleModelLoader", inputs: { model_name: m.upscale! } };
      g.upscaled = { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["upscaler", 0], image } };
      image = ["upscaled", 0];
    }
    // 大きな画像を lanczos で縮めると GPU のメモリを多く使った。縮めるときは area にする
    g.scale = { class_type: "ImageScale", inputs: { image, upscale_method: up && !useModel ? "lanczos" : "area", width: w, height: h, crop: "center" } };
    image = ["scale", 0];
  }
  // 描き直したときは、範囲の外を元の画像のまま残す
  if (r.redraw) image = redrawComposite(g, image, w, h, r.redraw.boxes);
  // ComfyUI の output フォルダーを増やさないよう、一時ファイルとして受け取る
  g[SAVE_NODE] = { class_type: "PreviewImage", inputs: { images: image } };
  return g;
}

// ---------------------------------------------------------------- 生成

/** 1枚の処理がこれより長ければ、止まったとみなす */
const STALL_MS = 25 * 60_000;
/** ComfyUI に送られてからこれより長く処理中なら、止まったとみなす */
const STALL_QUEUED_MS = 60 * 60_000;

export type Progress =
  | { phase: "upload" }
  | { phase: "free" }
  | { phase: "queued"; ahead: number; seconds: number }
  | { phase: "running"; seconds: number }
  | { phase: "download" };

export function progressText(p: Progress): string {
  switch (p.phase) {
    case "upload":
      return "参照画像を ComfyUI に送っています";
    case "free":
      return "前のモデルを ComfyUI から外しています";
    case "queued":
      return `順番を待っています(前に ${p.ahead} 件 · ${p.seconds}秒)`;
    case "running":
      return `画像を生成中(${p.seconds}秒)`;
    case "download":
      return "画像を受け取っています";
  }
}

export interface GenerateResult {
  png: Uint8Array;
  /** ComfyUI に送ったワークフロー(版に残して、同じ画像を作り直せるようにする) */
  workflow: Graph;
  promptId: string;
}

interface HistoryEntry {
  status?: { status_str?: string; messages?: [string, { exception_message?: string; node_type?: string }][] };
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
}

type Queue = { queue_running: unknown[][]; queue_pending: unknown[][] };

/** 参照する画像を ComfyUI の input フォルダーに送る(同じ名前なら上書きする) */
async function uploadImage(s: Url, name: string, bytes: Uint8Array): Promise<string> {
  const form = new FormData();
  const type = /\.jpe?g$/i.test(name) ? "image/jpeg" : /\.webp$/i.test(name) ? "image/webp" : "image/png";
  form.append("image", new Blob([bytes as BlobPart], { type }), name);
  form.append("subfolder", "euros");
  form.append("overwrite", "true");
  const { "Content-Type": _, ...rest } = headers(s);
  const res = await fetch(`${base(s)}/upload/image`, { method: "POST", headers: rest, body: form });
  if (!res.ok) throw new Error(`参照する画像を送れませんでした(${res.status})`);
  const out = (await res.json()) as { name: string; subfolder?: string };
  return out.subfolder ? `${out.subfolder}/${out.name}` : out.name;
}

/**
 * ComfyUI に今回とは別のモデルが載っていれば外す。
 * MOSS-Image を載せたまま MiniMax-H3-Image を動かすと、GPU のメモリを使い切って PC ごと固まったことがあった。
 * 載っているモデルは、直前の作業のワークフローで調べる。
 */
async function freeOtherModels(s: Url, m: ComfyModels, onProgress: (p: Progress) => void): Promise<void> {
  const history = await getJson<Record<string, { prompt?: unknown[] }>>(s, "/history?max_items=1").catch(() => ({}) as Record<string, { prompt?: unknown[] }>);
  const last = Object.values(history)[0]?.prompt?.[2] as Graph | undefined;
  if (!last) return;
  const used = (type: string, key: string) => Object.values(last).find((n) => n.class_type === type)?.inputs[key];
  const unet = used("UNETLoader", "unet_name");
  const clip = used("CLIPLoader", "clip_name");
  if ((unet === undefined || unet === m.unet) && (clip === undefined || clip === m.clip)) return;
  onProgress({ phase: "free" });
  const res = await post(s, "/free", { unload_models: true, free_memory: true });
  if (!res.ok) return;
  // 外し終わる前に次の作業が始まらないよう、少し待つ
  await sleep(3000);
}

/** 画像を1枚作って PNG で受け取る。中断すると ComfyUI 側の処理も止める */
export async function generateImage(
  s: Url,
  models: ComfyModels,
  req: ImageRequest,
  signal: AbortSignal,
  onProgress: (p: Progress) => void,
): Promise<GenerateResult> {
  if (req.references?.length || req.redraw) onProgress({ phase: "upload" });
  const references: string[] = [];
  for (const ref of req.references ?? []) references.push(await uploadImage(s, ref.name, ref.bytes));
  const redraw = req.redraw && { name: await uploadImage(s, req.redraw.name, req.redraw.bytes), boxes: req.redraw.boxes };
  await freeOtherModels(s, models, onProgress);

  const workflow = comfyWorkflow(models, { ...req, references, redraw });
  const res = await post(s, "/prompt", { prompt: workflow, client_id: "euros" });
  const sent = (await res.json().catch(() => ({}))) as { prompt_id?: string; error?: { message?: string } };
  if (!res.ok || !sent.prompt_id) throw new Error(`ComfyUI が受け付けませんでした:${sent.error?.message ?? res.status}`);
  const id = sent.prompt_id;
  const started = Date.now();
  // ComfyUI で処理中の作業と、それを最初に見た時刻(止まった作業の後ろに並ぶと、自分の番が来ないため)
  let runningId = "";
  let deadline = 0;
  let checked = 0;
  let ahead = -1;

  for (;;) {
    if (signal.aborted) {
      await post(s, "/queue", { delete: [id] }).catch(() => undefined);
      const q = await getJson<Queue>(s, "/queue").catch(() => ({ queue_running: [], queue_pending: [] }));
      if (q.queue_running.some((x) => x[1] === id)) await post(s, "/interrupt", {}).catch(() => undefined);
      throw new DOMException("中断しました", "AbortError");
    }
    const history = await getJson<Record<string, HistoryEntry>>(s, `/history/${id}`).catch((e: unknown) => {
      throw new Error(`生成の途中で ComfyUI との接続が切れました。ComfyUI が終了していないか確認してください(${e instanceof Error ? e.message : String(e)})`);
    });
    const h = history[id];
    if (h) {
      if (h.status?.status_str !== "success") {
        const e = h.status?.messages?.find(([k]) => k === "execution_error")?.[1];
        throw new Error(`画像を作れませんでした:${e?.exception_message?.trim() ?? "ComfyUI のログを確認してください"}`);
      }
      const im = h.outputs?.[SAVE_NODE]?.images?.[0];
      if (!im) throw new Error("ComfyUI から画像を受け取れませんでした");
      onProgress({ phase: "download" });
      const q = new URLSearchParams({ filename: im.filename, subfolder: im.subfolder, type: im.type });
      const file = await fetch(`${base(s)}/view?${q}`, { headers: headers(s) });
      if (!file.ok) throw new Error(`画像を受け取れませんでした(${file.status})`);
      return { png: new Uint8Array(await file.arrayBuffer()), workflow, promptId: id };
    }
    if (Date.now() - checked > 3_000) {
      checked = Date.now();
      const q = await getJson<Queue>(s, "/queue").catch(() => null);
      if (q) {
        const mine = q.queue_running.some((x) => x[1] === id);
        // 待ちの列は番号(先頭の値)の小さい順に処理される
        const myNumber = q.queue_pending.find((x) => x[1] === id)?.[0] as number | undefined;
        ahead = mine ? 0 : myNumber === undefined ? 0 : q.queue_running.length + q.queue_pending.filter((x) => (x[0] as number) < myNumber).length;
        // GPU のエラーで ComfyUI の処理が止まると、処理中のまま終わらない。長すぎたら知らせる
        const running = q.queue_running[0];
        const rid = typeof running?.[1] === "string" ? running[1] : "";
        if (rid !== runningId) {
          runningId = rid;
          const created = (running?.[3] as { create_time?: number } | undefined)?.create_time;
          deadline = rid ? Math.min(Date.now() + STALL_MS, typeof created === "number" ? created + STALL_QUEUED_MS : Infinity) : 0;
        }
      }
    }
    if (deadline && Date.now() > deadline) {
      await post(s, "/queue", { delete: [id] }).catch(() => undefined);
      throw new Error("ComfyUI の処理が長い時間進んでいません。ComfyUI のコンソールにエラーが出ていれば、ComfyUI を起動し直してから作り直してください。");
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    onProgress(ahead > 0 ? { phase: "queued", ahead, seconds } : { phase: "running", seconds });
    await sleep(1000, signal);
  }
}
