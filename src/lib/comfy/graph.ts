import type { Box1000 } from "../../types";

/** ComfyUI の API 形式のワークフロー */
export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export type Link = [string, number];

/** 範囲を塗ったマスク(w×h)を作り、そのノードの名前を返す */
function maskNodes(g: Graph, id: string, w: number, h: number, boxes: Box1000[]): string {
  g[`${id}_base`] = { class_type: "SolidMask", inputs: { value: 0, width: w, height: h } };
  let last = `${id}_base`;
  boxes.forEach(([y0, x0, y1, x1], i) => {
    const x = Math.max(0, Math.floor((x0 * w) / 1000));
    const y = Math.max(0, Math.floor((y0 * h) / 1000));
    const bw = Math.max(8, Math.min(w, Math.ceil((x1 * w) / 1000)) - x);
    const bh = Math.max(8, Math.min(h, Math.ceil((y1 * h) / 1000)) - y);
    g[`${id}_box${i}`] = { class_type: "SolidMask", inputs: { value: 1, width: bw, height: bh } };
    g[`${id}_add${i}`] = { class_type: "MaskComposite", inputs: { destination: [last, 0], source: [`${id}_box${i}`, 0], x, y, operation: "add" } };
    last = `${id}_add${i}`;
  });
  return last;
}

/** 描き直すとき:元の画像を描く大きさにして、範囲の外は元のままにする潜在画像 */
export function redrawLatent(g: Graph, image: string, w: number, h: number, boxes: Box1000[]): Link {
  g.redrawSrc = { class_type: "LoadImage", inputs: { image } };
  g.redrawGen = { class_type: "ImageScale", inputs: { image: ["redrawSrc", 0], upscale_method: "lanczos", width: w, height: h, crop: "center" } };
  g.redrawEnc = { class_type: "VAEEncode", inputs: { pixels: ["redrawGen", 0], vae: ["vae", 0] } };
  g.redrawNoise = { class_type: "SetLatentNoiseMask", inputs: { samples: ["redrawEnc", 0], mask: [maskNodes(g, "genMask", w, h, boxes), 0] } };
  return ["redrawNoise", 0];
}

/** 描き直した画像を、仕上がりの大きさの元の画像に、範囲だけ(境目はぼかして)重ねる */
export function redrawComposite(g: Graph, image: Link, w: number, h: number, boxes: Box1000[]): Link {
  g.redrawFinal = { class_type: "ImageScale", inputs: { image: ["redrawSrc", 0], upscale_method: "lanczos", width: w, height: h, crop: "center" } };
  g.redrawMaskImage = { class_type: "MaskToImage", inputs: { mask: [maskNodes(g, "finalMask", w, h, boxes), 0] } };
  const radius = Math.max(4, Math.min(31, Math.round(Math.min(w, h) / 120)));
  g.redrawBlur = { class_type: "ImageBlur", inputs: { image: ["redrawMaskImage", 0], blur_radius: radius, sigma: radius / 2 } };
  g.redrawSoft = { class_type: "ImageToMask", inputs: { image: ["redrawBlur", 0], channel: "red" } };
  g.redrawComp = { class_type: "ImageCompositeMasked", inputs: { destination: ["redrawFinal", 0], source: image, x: 0, y: 0, resize_source: false, mask: ["redrawSoft", 0] } };
  return ["redrawComp", 0];
}

/** 参照する画像を読み込み、約1MPにそろえる */
export function referenceNode(g: Graph, id: string, image: string, steps: number): Link {
  g[id] = { class_type: "LoadImage", inputs: { image } };
  g[`${id}Scaled`] = { class_type: "ImageScaleToTotalPixels", inputs: { image: [id, 0], upscale_method: "lanczos", megapixels: 1, resolution_steps: steps } };
  return [`${id}Scaled`, 0];
}
