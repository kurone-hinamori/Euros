import type { Box1000, ImageEngine, SamplingMode, SamplingParams } from "../../types";
import { type Graph, type Link, redrawLatent, referenceNode } from "./graph";

// 画像生成のモデルの登録。モデルを増やすときは、EngineDef を1つ作って ENGINES に足す。

export type FileKind = "unet" | "clip" | "vae";

export const FILE_KINDS: FileKind[] = ["unet", "clip", "vae"];

export const FILE_LABEL: Record<FileKind, string> = {
  unet: "拡散モデル(diffusion_models)",
  clip: "テキストエンコーダー(text_encoders)",
  vae: "VAE(vae)",
};

/** ComfyUI で使うファイル。detectComfy が選ぶ */
export interface ComfyModels {
  engine: ImageEngine;
  unet: string;
  clip: string;
  vae: string;
  /** 拡大用のモデル。なければ通常の拡大をする */
  upscale?: string;
  /** 画像を参照するための LoRA(MOSS-Image の Edit LoRA) */
  lora?: string;
}

/** ComfyUI に送る前の参照画像(name は ComfyUI の input フォルダーでの名前) */
export interface ComfyImage {
  name: string;
  bytes: Uint8Array;
}

export interface ImageRequest {
  prompt: string;
  /** 仕上がりの大きさ */
  width: number;
  height: number;
  seed: number;
  /** 否定のプロンプト(効かないモデルもある)。未指定は DEFAULT_NEGATIVE */
  negative?: string;
  references?: ComfyImage[];
  /** 描き直す元の画像と範囲。範囲の外は元の画像のまま残す */
  redraw?: ComfyImage & { boxes: Box1000[] };
}

/** ComfyUI に送る直前の内容(画像はアップロード済みで、名前だけを持つ) */
export type UploadedRequest = Omit<ImageRequest, "references" | "redraw"> & {
  references: string[];
  redraw?: { name: string; boxes: Box1000[] };
};

export const DEFAULT_NEGATIVE = "nsfw, worst quality, low quality, bad anatomy, extra fingers, watermark, signature, jpeg artifact";

export type Sampling = Required<SamplingParams>;

export const SAMPLING_MODE_LABEL: Record<SamplingMode, string> = { text: "文章から描くとき", reference: "参照画像を使うとき" };

/** 設定できる範囲(ComfyUI の KSampler が受け付ける範囲より狭くしている) */
export const SAMPLING_LIMITS = { steps: { min: 1, max: 150 }, cfg: { min: 0, max: 30 } } as const;

/** ステップ数が範囲内の整数か */
export const validSteps = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= SAMPLING_LIMITS.steps.min && v <= SAMPLING_LIMITS.steps.max;

/** CFG が範囲内の正の数か */
export const validCfg = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > SAMPLING_LIMITS.cfg.min && v <= SAMPLING_LIMITS.cfg.max;

const validName = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** 設定の値で既定値を上書きする。おかしい値・空の項目は既定値のまま */
export function resolveSampling(base: Sampling, own: SamplingParams | undefined): Sampling {
  return {
    steps: validSteps(own?.steps) ? own.steps : base.steps,
    cfg: validCfg(own?.cfg) ? own.cfg : base.cfg,
    sampler: validName(own?.sampler) ? own.sampler : base.sampler,
    scheduler: validName(own?.scheduler) ? own.scheduler : base.scheduler,
  };
}

export interface EngineDef {
  id: ImageEngine;
  label: string;
  /** 設定の画面に出す説明 */
  note: string;
  /** 自動で選ぶファイル(名前の先頭で探す)と、見つからないときに示すファイル */
  files: Record<FileKind, { prefixes: string[]; need: string }>;
  /** 参照用の LoRA を探す(なければ undefined) */
  findLora?: (loras: string[]) => string | undefined;
  /** 画像を参照できるか */
  canReference: (m: ComfyModels) => boolean;
  /** 否定のプロンプトが効くか */
  negative: boolean;
  /** 実際に描く大きさ(仕上がりの大きさと違えば、最後に拡大・縮小する)。referencing は参照画像を使うとき */
  drawSize: (w: number, h: number, referencing?: boolean) => [number, number];
  /** KSampler の既定値。reference があれば、参照画像を使うときはそちらを使う */
  sampling: { text: Sampling; reference?: Sampling };
  /** 描く部分のワークフロー。描いた画像(仕上がりの大きさにする前)のノードを返す */
  build: (g: Graph, m: ComfyModels, r: UploadedRequest, size: [number, number], sp: Sampling) => Link;
}

const round = (v: number, step: number) => Math.round(v / step) * step;

/** MOSS-Image(公式テンプレートの MOSS-Image: Text to Image / Image Edit と同じ設定) */
const moss: EngineDef = {
  id: "moss",
  label: "MOSS-Image",
  note: "ネガティブプロンプトが効きます。Edit LoRA があれば参照画像を使えます。",
  files: {
    unet: { prefixes: ["moss_image_sft", "moss_image_base"], need: "moss_image_base_int8_convrot.safetensors(models/diffusion_models)" },
    clip: { prefixes: ["qwen3.5_9b"], need: "qwen3.5_9b_w4a8_gptq.safetensors(models/text_encoders)" },
    vae: { prefixes: ["flux2-vae"], need: "flux2-vae_small.safetensors(models/vae)" },
  },
  findLora: (loras) => loras.find((m) => m.startsWith("moss_image_edit")),
  canReference: (m) => !!m.lora,
  negative: true,
  // 約2MPで描く(大きいほど崩れやすい)。参照するときは、参照画像と同じ約1MPで描く
  // (公式テンプレートと同じ。大きさが違うと、レイアウトが崩れ、色も薄くなった)
  drawSize: (w, h, referencing) => {
    const k = Math.min(1, Math.sqrt((referencing ? 1_048_576 : 2_097_152) / (w * h)));
    return [round(w * k, 16), round(h * k, 16)];
  },
  // 参照するときは公式の Image Edit のテンプレートの値
  sampling: {
    text: { steps: 25, cfg: 2.5, sampler: "er_sde", scheduler: "simple" },
    reference: { steps: 30, cfg: 4, sampler: "euler", scheduler: "normal" },
  },
  build: (g, m, r, [w, h], sp) => {
    Object.assign(g, {
      unet: { class_type: "UNETLoader", inputs: { unet_name: m.unet, weight_dtype: "default" } },
      clip: { class_type: "CLIPLoader", inputs: { clip_name: m.clip, type: "moss_image", device: "default" } },
      vae: { class_type: "VAELoader", inputs: { vae_name: m.vae } },
      positive: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: r.prompt } },
      negative: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: r.negative ?? DEFAULT_NEGATIVE } },
      latent: { class_type: "EmptyFlux2LatentImage", inputs: { width: w, height: h, batch_size: 1 } },
    } satisfies Graph);
    g.sampler = {
      class_type: "KSampler",
      inputs: {
        model: ["unet", 0],
        seed: r.seed,
        steps: sp.steps,
        cfg: sp.cfg,
        sampler_name: sp.sampler,
        scheduler: sp.scheduler,
        positive: ["positive", 0],
        negative: ["negative", 0],
        latent_image: ["latent", 0],
        denoise: 1,
      },
    };
    if (r.redraw) {
      g.sampler.inputs.latent_image = redrawLatent(g, r.redraw.name, w, h, r.redraw.boxes);
      delete g.latent;
    }
    if (r.references.length && m.lora) {
      g.lora = { class_type: "LoraLoaderModelOnly", inputs: { model: ["unet", 0], lora_name: m.lora, strength_model: 1 } };
      g.slg = { class_type: "SkipLayerGuidanceDiTSimple", inputs: { model: ["lora", 0], double_layers: "", single_layers: "22", start_percent: 0, end_percent: 1 } };
      const images = Object.fromEntries(r.references.map((name, i) => [`images.image_${i}`, referenceNode(g, `ref${i}`, name, 16)]));
      const encode = (text: string) => ({
        class_type: "TextEncodeMOSSImageEdit",
        inputs: { clip: ["clip", 0], prompt: text, edit_format: "Moss-Image-Edit", image_strength: 1, vae: ["vae", 0], ...images },
      });
      g.positive = encode(r.prompt);
      g.negative = encode(r.negative ?? DEFAULT_NEGATIVE);
      g.sampler.inputs.model = ["slg", 0];
    }
    g.decode = { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["vae", 0] } };
    return ["decode", 0];
  },
};

/** MiniMax-H3-Image(公式テンプレートと同じ:6ステップ、CFG 1、ネガティブなし) */
const minimaxH3: EngineDef = {
  id: "minimax_h3",
  label: "MiniMax-H3-Image",
  note: "約4MPで描いて仕上がりの大きさに縮めます。参照画像をそのまま使えます。ネガティブプロンプトは効きません。",
  files: {
    unet: { prefixes: ["minimax_h3_image"], need: "minimax_h3_image_pruned_int8_convrot.safetensors(models/diffusion_models)" },
    clip: { prefixes: ["qwen3vl_32b_minimax_h3"], need: "qwen3vl_32b_minimax_h3_int8_convrot.safetensors(models/text_encoders)" },
    vae: { prefixes: ["minimax_h3_image_vae"], need: "minimax_h3_image_vae_fp16.safetensors(models/vae)" },
  },
  canReference: () => true,
  negative: false,
  // 4MP より小さいと崩れる(公式の注意)ので、仕上がりの縦横比のまま約4MPで描く
  drawSize: (w, h) => {
    const k = Math.sqrt(4_194_304 / (w * h));
    return [Math.max(1024, round(w * k, 32)), Math.max(1024, round(h * k, 32))];
  },
  sampling: { text: { steps: 6, cfg: 1, sampler: "euler", scheduler: "simple" } },
  build: (g, m, r, [w, h], sp) => {
    g.unet = { class_type: "UNETLoader", inputs: { unet_name: m.unet, weight_dtype: "default" } };
    g.clip = { class_type: "CLIPLoader", inputs: { clip_name: m.clip, type: "minimax", device: "default" } };
    g.vae = { class_type: "VAELoader", inputs: { vae_name: m.vae } };
    const images: Record<string, Link> = Object.fromEntries(r.references.map((name, i) => [`images.image_${i + 1}`, referenceNode(g, `ref${i}`, name, 32)]));
    let prompt = r.prompt;
    if (r.redraw) {
      // 描き直すときは元の絵も見せる(見せないと、描き直した所だけ周りとなじまなかった)
      const n = r.references.length + 1;
      images[`images.image_${n}`] = referenceNode(g, "redrawRef", r.redraw.name, 32);
      prompt += `\n<Picture ${n}> is the current version of this same image. Keep its background, colors and lighting, and blend seamlessly with it.`;
    }
    g.positive = { class_type: "MiniMaxH3ImageConditioning", inputs: { clip: ["clip", 0], vae: ["vae", 0], prompt, width: w, height: h, ...images } };
    g.negative = { class_type: "ConditioningZeroOut", inputs: { conditioning: ["positive", 0] } };
    g.sampler = {
      class_type: "KSampler",
      inputs: {
        model: ["unet", 0],
        seed: r.seed,
        steps: sp.steps,
        cfg: sp.cfg,
        sampler_name: sp.sampler,
        scheduler: sp.scheduler,
        positive: ["positive", 0],
        negative: ["negative", 0],
        latent_image: r.redraw ? redrawLatent(g, r.redraw.name, w, h, r.redraw.boxes) : ["positive", 1],
        denoise: 1,
      },
    };
    g.decode = { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["vae", 0] } };
    return ["decode", 0];
  },
};

export const ENGINES: Record<ImageEngine, EngineDef> = { moss, minimax_h3: minimaxH3 };

export const engineOf = (id: ImageEngine | undefined): EngineDef => ENGINES[id ?? "moss"] ?? moss;

/** そのモデルで設定できる場面(参照画像で既定値が変わるモデルだけ2つ) */
export const samplingModes = (def: EngineDef): SamplingMode[] => (def.sampling.reference ? ["text", "reference"] : ["text"]);
