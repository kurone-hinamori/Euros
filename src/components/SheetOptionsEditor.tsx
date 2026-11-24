import type { SheetOptions } from "../types";
import { STYLE_PRESETS } from "../lib/sheet";

/** 画風と、シートに並べる表情 */
export function SheetOptionsEditor(props: { style: string; sheet: SheetOptions; onChange: (style: string, sheet: SheetOptions) => void; disabled?: boolean }) {
  const { style, sheet } = props;
  const preset = STYLE_PRESETS.find((p) => p.en === style);
  const setExp = (i: number, field: "ja" | "en", v: string) =>
    props.onChange(style, { ...sheet, expressions: sheet.expressions.map((e, j) => (j === i ? { ...e, [field]: v } : e)) });
  return (
    <div>
      <label className="field">
        <span>画風</span>
        <select disabled={props.disabled} value={preset?.en ?? ""} onChange={(e) => e.target.value && props.onChange(e.target.value, sheet)}>
          {!preset && <option value="">自由に書く</option>}
          {STYLE_PRESETS.map((p) => (
            <option key={p.en} value={p.en}>
              {p.label}
            </option>
          ))}
        </select>
        <textarea className="en" rows={2} disabled={props.disabled} value={style} onChange={(e) => props.onChange(e.target.value, sheet)} />
      </label>
      <div className="field">
        <span>表情一覧(最大9つ。左が画面に出す名前、右が生成に使う英語)</span>
        {sheet.expressions.map((e, i) => (
          <div key={i} className="exp-row">
            <input disabled={props.disabled} value={e.ja} onChange={(ev) => setExp(i, "ja", ev.target.value)} />
            <input className="en" disabled={props.disabled} value={e.en} onChange={(ev) => setExp(i, "en", ev.target.value)} />
            <button className="small ghost" disabled={props.disabled} onClick={() => props.onChange(style, { ...sheet, expressions: sheet.expressions.filter((_, j) => j !== i) })}>
              外す
            </button>
          </div>
        ))}
        <div>
          <button
            className="small"
            disabled={props.disabled || sheet.expressions.length >= 9}
            onClick={() => props.onChange(style, { ...sheet, expressions: [...sheet.expressions, { ja: "", en: "" }] })}
          >
            表情を足す
          </button>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" disabled={props.disabled} checked={sheet.notHuman} onChange={(e) => props.onChange(style, { ...sheet, notHuman: e.target.checked })} />
        人ではない(ロボット・動物・物など)
      </label>
    </div>
  );
}
