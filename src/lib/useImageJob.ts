import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings } from "../types";
import { type ComfyModels, type GenerateResult, type ImageRequest, detectComfy, generateImage, progressText } from "./comfy";
import { unloadModel } from "./ollama";

export type JobResult = GenerateResult & { models: ComfyModels };

export type JobState =
  | { kind: "idle" }
  | { kind: "running"; text: string }
  | { kind: "done"; result: JobResult }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/**
 * 画像を1枚作る処理と、その進み具合・中断。
 * ComfyUI と同じ GPU に Ollama のモデルが載ったままだと止まることがあるので、先に Ollama のモデルを外す。
 */
export function useImageJob(settings: Settings) {
  const [state, setState] = useState<JobState>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);

  // 画面を離れたら中断する
  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(
    async (req: ImageRequest | ((models: ComfyModels) => ImageRequest)): Promise<JobResult | null> => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        setState({ kind: "running", text: "ComfyUI のモデルを確認しています" });
        const models = await detectComfy(settings);
        setState({ kind: "running", text: "Ollama のモデルを GPU から外しています" });
        await unloadModel(settings);
        // 依頼の中身がモデルで変わる(参照できるかなど)ときは、関数で受け取る
        const request = typeof req === "function" ? req(models) : req;
        const generated = await generateImage(settings, models, request, ctrl.signal, (p) => {
          if (!ctrl.signal.aborted) setState({ kind: "running", text: progressText(p) });
        });
        const result = { ...generated, models };
        setState({ kind: "done", result });
        return result;
      } catch (e) {
        if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) setState({ kind: "cancelled" });
        else setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        return null;
      } finally {
        if (abort.current === ctrl) abort.current = null;
      }
    },
    [settings],
  );

  const cancel = useCallback(() => abort.current?.abort(), []);

  return { state, run, cancel, running: state.kind === "running" };
}
