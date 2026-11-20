import { useState } from "react";
import type { Appearance, AppearanceKey } from "../types";
import { APPEARANCE_KEYS, APPEARANCE_LABEL } from "../types";

/** 英語の元になった日本語。日本語を直すと、英語が古いことが分かる */
export type EnSource = Partial<Record<AppearanceKey, string>>;

export const sourceOf = (a: Appearance): EnSource => Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, a[k].ja]));

/** 日本語を直したあと、英語を作り直していない項目 */
export const staleKeys = (a: Appearance, from: EnSource) => APPEARANCE_KEYS.filter((k) => (from[k] ?? "") !== a[k].ja);

/** 外見の項目(日本語と英語)を直す */
export function AppearanceEditor(props: {
  appearance: Appearance;
  from: EnSource;
  onChange: (a: Appearance, from: EnSource) => void;
  onTranslate: () => void;
  translating: boolean;
  disabled?: boolean;
}) {
  const { appearance: a, from } = props;
  const [showEn, setShowEn] = useState(false);
  const stale = staleKeys(a, from);
  const set = (k: AppearanceKey, field: "ja" | "en", v: string) => {
    const next = { ...a, [k]: { ...a[k], [field]: v } };
    // 英語を直接直したら、いまの日本語から訳したものとみなす
    props.onChange(next, field === "en" ? { ...from, [k]: a[k].ja } : from);
  };
  return (
    <div>
      <div className="appearance">
        {APPEARANCE_KEYS.map((k) => (
          <label key={k} className="field">
            <span>
              {APPEARANCE_LABEL[k]}
              {stale.includes(k) && <span className="tag">英語が古い</span>}
            </span>
            <textarea rows={2} disabled={props.disabled} value={a[k].ja} onChange={(e) => set(k, "ja", e.target.value)} />
            {showEn && <textarea className="en" rows={2} disabled={props.disabled} value={a[k].en} onChange={(e) => set(k, "en", e.target.value)} />}
          </label>
        ))}
      </div>
      <div className="row">
        <button className="small" disabled={props.disabled || props.translating || !stale.length} onClick={props.onTranslate}>
          {props.translating ? "英語に訳しています…" : `直した項目を英語に訳す${stale.length ? `(${stale.length})` : ""}`}
        </button>
        <label className="check">
          <input type="checkbox" checked={showEn} onChange={(e) => setShowEn(e.target.checked)} />
          英語(生成に使う文)も見る
        </label>
      </div>
    </div>
  );
}
