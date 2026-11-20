import { useEffect, useMemo, useRef, useState } from "react";
import type { ReferenceImage } from "../types";
import { type PendingReference, readReference } from "../lib/character";

export const USE_LABEL: Record<ReferenceImage["use"], string> = {
  all: "全体(顔・髪・衣装)",
  face: "顔と髪だけ",
  outfit: "衣装と小物だけ",
  style: "画風だけ",
};

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** 参照画像の読み込み(ドラッグ&ドロップか、ファイルを選ぶ)と一覧 */
export function ReferencePicker(props: { refs: PendingReference[]; onChange: (refs: PendingReference[]) => void; disabled?: boolean; warning?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");

  const urls = useMemo(() => new Map(props.refs.map((r) => [r.id, URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: MIME[r.ext] ?? "image/png" }))])), [props.refs]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    const added: PendingReference[] = [];
    for (const f of Array.from(files)) {
      try {
        added.push(await readReference(f));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    props.onChange([...props.refs, ...added]);
  };

  return (
    <div>
      <div
        className={`drop${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!props.disabled) void add(e.dataTransfer.files);
        }}
      >
        <span className="muted">画像をここにドロップするか</span>
        <button className="small" disabled={props.disabled} onClick={() => input.current?.click()}>
          ファイルを選ぶ
        </button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => void add(e.target.files).then(() => (e.target.value = ""))} />
      </div>
      {error && <p className="error">{error}</p>}
      {props.warning && props.refs.length > 0 && <p className="muted">{props.warning}</p>}
      {props.refs.length > 0 && (
        <div className="refs">
          {props.refs.map((r) => (
            <div key={r.id} className="ref">
              <img src={urls.get(r.id)} alt={r.label} />
              <div className="ref-meta">
                <div className="ref-name" title={r.label}>
                  {r.label}
                </div>
                <select disabled={props.disabled} value={r.use} onChange={(e) => props.onChange(props.refs.map((x) => (x.id === r.id ? { ...x, use: e.target.value as ReferenceImage["use"] } : x)))}>
                  {Object.entries(USE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <button className="small ghost" disabled={props.disabled} onClick={() => props.onChange(props.refs.filter((x) => x.id !== r.id))}>
                  外す
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
