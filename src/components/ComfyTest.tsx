import { useEffect, useState } from "react";
import type { Settings } from "../types";
import { useImageJob } from "../lib/useImageJob";

const SAMPLE =
  "Anime style character illustration on a plain white background. A girl with short silver hair and blue eyes, wearing a black hooded coat, standing, full body, front view. Clean line art, flat cel shading.";

const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

/** 設定の画面で、1枚作って生成できるか試す */
export function ComfyTest({ settings }: { settings: Settings }) {
  const job = useImageJob(settings);
  const [prompt, setPrompt] = useState(SAMPLE);
  const [url, setUrl] = useState<string>();
  const [took, setTook] = useState("");

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const run = async () => {
    const started = Date.now();
    const r = await job.run({ prompt, width: 768, height: 1024, seed: randomSeed() });
    if (!r) return;
    setUrl(URL.createObjectURL(new Blob([r.png as BlobPart], { type: "image/png" })));
    setTook(`${Math.round((Date.now() - started) / 1000)}秒`);
  };

  const s = job.state;
  return (
    <>
      <label className="field">
        <span>試しに描く内容(英語)</span>
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <div className="row">
        {job.running ? (
          <button onClick={job.cancel}>中断</button>
        ) : (
          <button className="primary" disabled={!prompt.trim()} onClick={() => void run()}>
            試しに1枚作る
          </button>
        )}
        {s.kind === "running" && <span className="muted">{s.text}</span>}
        {s.kind === "done" && <span className="muted">できました({took})</span>}
        {s.kind === "cancelled" && <span className="muted">中断しました</span>}
        {s.kind === "error" && <span className="error">{s.message}</span>}
      </div>
      {url && <img className="test-image" src={url} alt="試しに作った画像" />}
    </>
  );
}
