import { fetch } from "@tauri-apps/plugin-http";
import type { Settings } from "../types";

// 生成のワークフローは手順2で Notos から移す。いまは接続の確認だけ。

type Url = Pick<Settings, "comfyUrl">;

const base = (s: Url) => s.comfyUrl.replace(/\/+$/, "");

/** ComfyUI も Origin ヘッダーを検査するので、ComfyUI 自身のオリジンを名乗る */
export function comfyHeaders(s: Url): Record<string, string> {
  try {
    return { "Content-Type": "application/json", Origin: new URL(base(s)).origin };
  } catch {
    return { "Content-Type": "application/json" };
  }
}

export interface ComfyStats {
  version: string;
  devices: { name: string; vram_total: number; vram_free: number }[];
}

/** 接続の確認。ComfyUI のバージョンと GPU を返す */
export async function comfyStats(s: Url): Promise<ComfyStats> {
  const res = await fetch(`${base(s)}/system_stats`, { headers: comfyHeaders(s) });
  if (!res.ok) throw new Error(`ComfyUI エラー ${res.status}`);
  const data = (await res.json()) as { system?: { comfyui_version?: string }; devices?: ComfyStats["devices"] };
  return { version: data.system?.comfyui_version ?? "不明", devices: data.devices ?? [] };
}
