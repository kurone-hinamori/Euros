import type { BodyForm, BodyShape, Build, Equipment, EquipmentForm, Figure } from "../types";
import { BODY_FORMS, BODY_FORM_LABEL, BODY_SIZE_KEYS, BUILDS, BUILD_LABEL, EQUIPMENT_FORMS, EQUIPMENT_FORM_LABEL, EQUIPMENT_SIZE_KEYS } from "../types";
import { BODY_SIZE_LABEL, EQUIPMENT_SIZE_LABEL, parseNumber } from "../lib/figure";

// 3D の目安(Boreas が読む数値)の入力欄。どれも空のままでよい。

/** 数の入力欄 */
function NumberField(props: { label: string; unit: string; value?: number; disabled?: boolean; step?: string; onChange: (v: number | undefined) => void }) {
  return (
    <label className="field shape-num">
      <span>
        {props.label}({props.unit})
      </span>
      <input type="number" min="0" step={props.step ?? "any"} disabled={props.disabled} value={props.value ?? ""} onChange={(e) => props.onChange(parseNumber(e.target.value))} />
    </label>
  );
}

/** キャラクターの 3D の目安。人物なら身長・体型・頭身、人ではないなら形の種類と大きさ */
export function FigureEditor(props: { figure: Figure; notHuman: boolean; disabled?: boolean; onChange: (f: Figure) => void }) {
  const f = props.figure;
  const set = (patch: Partial<Figure>) => props.onChange({ ...f, ...patch });
  const body = f.body;
  const setBody = (b: BodyShape | undefined) => set({ body: b });
  return (
    <div>
      <p className="muted small-text" style={{ marginTop: 0 }}>
        Boreas(3D の下絵)で使う大きさの目安です。シートの生成には使いません。分からなければ空のままにしてください。
      </p>
      {!props.notHuman ? (
        <div className="shape-row">
          <NumberField label="身長" unit="cm" value={f.heightCm} disabled={props.disabled} onChange={(v) => set({ heightCm: v })} />
          <label className="field shape-num">
            <span>体型</span>
            <select disabled={props.disabled} value={f.build ?? ""} onChange={(e) => set({ build: (e.target.value || undefined) as Build | undefined })}>
              <option value="">決めない</option>
              {BUILDS.map((b) => (
                <option key={b} value={b}>
                  {BUILD_LABEL[b]}
                </option>
              ))}
            </select>
          </label>
          <NumberField label="頭身" unit="頭" step="0.5" value={f.heads} disabled={props.disabled} onChange={(v) => set({ heads: v })} />
        </div>
      ) : (
        <>
          <div className="shape-row">
            <label className="field shape-num">
              <span>形の種類</span>
              <select
                disabled={props.disabled}
                value={body?.form ?? ""}
                onChange={(e) => setBody(e.target.value ? { ...body, form: e.target.value as BodyForm, size: body?.size ?? {} } : undefined)}
              >
                <option value="">決めない</option>
                {BODY_FORMS.map((b) => (
                  <option key={b} value={b}>
                    {BODY_FORM_LABEL[b]}
                  </option>
                ))}
              </select>
            </label>
            {body &&
              BODY_SIZE_KEYS[body.form].map((k) => (
                <NumberField key={k} label={BODY_SIZE_LABEL[k]} unit="m" value={body.size[k]} disabled={props.disabled} onChange={(v) => setBody({ ...body, size: { ...body.size, [k]: v } })} />
              ))}
          </div>
          {body && (body.form === "biped_monster" || body.form === "quadruped") && (
            <div className="row">
              {body.form === "biped_monster" && (
                <label className="check">
                  <input type="checkbox" disabled={props.disabled} checked={body.arms ?? true} onChange={(e) => setBody({ ...body, arms: e.target.checked })} />
                  腕がある
                </label>
              )}
              <label className="check">
                <input type="checkbox" disabled={props.disabled} checked={body.tail ?? false} onChange={(e) => setBody({ ...body, tail: e.target.checked })} />
                尾がある
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export type EquipmentShape = Pick<Equipment, "form" | "size">;

/** 装備品の 3D の目安の型と寸法 */
export function EquipmentShapeEditor(props: { shape: EquipmentShape; disabled?: boolean; onChange: (s: EquipmentShape) => void }) {
  const { form, size = {} } = props.shape;
  return (
    <div className="field">
      <span>3D の型と寸法(Boreas で使う目安。空のままでもよい)</span>
      <div className="shape-row">
        <label className="field shape-num">
          <span>型</span>
          <select disabled={props.disabled} value={form ?? ""} onChange={(e) => props.onChange({ form: (e.target.value || undefined) as EquipmentForm | undefined, size })}>
            <option value="">決めない</option>
            {EQUIPMENT_FORMS.map((f) => (
              <option key={f} value={f}>
                {EQUIPMENT_FORM_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        {form &&
          EQUIPMENT_SIZE_KEYS[form].map((k) => (
            <NumberField key={k} label={EQUIPMENT_SIZE_LABEL[k]} unit="cm" value={size[k]} disabled={props.disabled} onChange={(v) => props.onChange({ form, size: { ...size, [k]: v } })} />
          ))}
      </div>
    </div>
  );
}
