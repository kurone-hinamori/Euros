import { useEffect, useState } from "react";
import type { ImageEngine, Settings } from "../types";
import { type ComfyModels, type FileKind, autoFile, comfyFileLists, detectComfy, ENGINES, engineOf, FILE_KINDS, FILE_LABEL } from "../lib/comfy";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 画像生成のモデルと、ComfyUI のファイルを選ぶ */
export function ImageModelSettings({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const def = engineOf(settings.imageEngine);
  const own = settings.imageFiles?.[def.id] ?? {};
  const [lists, setLists] = useState<Record<FileKind, string[]> | null>(null);
  const [detected, setDetected] = useState<{ ok: true; models: ComfyModels } | { ok: false; text: string } | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      setLists(await comfyFileLists(settings));
    } catch {
      setLists(null);
      setError(`ComfyUI に接続できません(${settings.comfyUrl})。起動してから「ファイルの一覧を更新」を押してください。`);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.comfyUrl]);

  // 選んだモデルで生成できるか(必要なファイルがそろっているか)
  useEffect(() => {
    if (!lists) return setDetected(null);
    let alive = true;
    detectComfy(settings)
      .then((models) => alive && setDetected({ ok: true, models }))
      .catch((e) => alive && setDetected({ ok: false, text: message(e) }));
    return () => {
      alive = false;
    };
    // ファイルにかかわる設定が変わったときだけ確かめる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, settings.imageEngine, JSON.stringify(settings.imageFiles)]);

  const setFile = (k: FileKind, v: string) =>
    onChange({ ...settings, imageFiles: { ...settings.imageFiles, [def.id]: { ...own, [k]: v || undefined } } });

  return (
    <>
      <label className="field">
        <span>画像生成のモデル</span>
        <select value={def.id} onChange={(e) => onChange({ ...settings, imageEngine: e.target.value as ImageEngine })}>
          {Object.values(ENGINES).map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
        <small className="muted">{def.note}</small>
      </label>
      {FILE_KINDS.map((k) => {
        const list = lists?.[k] ?? [];
        const auto = lists ? autoFile(def.id, k, list) : undefined;
        return (
          <label key={k} className="field">
            <span>{FILE_LABEL[k]}</span>
            <select value={own[k] ?? ""} onChange={(e) => setFile(k, e.target.value)}>
              <option value="">自動{lists ? `(${auto ?? "見つかりません"})` : ""}</option>
              {own[k] && !list.includes(own[k]!) && <option value={own[k]}>{own[k]}(ComfyUI にありません)</option>}
              {list.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <div className="row">
        <button className="small" onClick={() => void load()}>
          ファイルの一覧を更新
        </button>
        {error && <span className="error">{error}</span>}
      </div>
      {detected && (
        <p className="muted" style={{ margin: 0 }}>
          {detected.ok ? (
            <>
              使えます。参照画像:{def.canReference(detected.models) ? `使えます${detected.models.lora ? `(${detected.models.lora})` : ""}` : "使えません(Edit LoRA が見つかりません)"}
              {" · "}拡大:{detected.models.upscale ?? "通常の拡大"}
            </>
          ) : (
            <span className="error">{detected.text}</span>
          )}
        </p>
      )}
    </>
  );
}
