import type { Profile } from "../types";

const FIELDS: { key: keyof Profile; label: string; long?: boolean }[] = [
  { key: "name", label: "名前" },
  { key: "reading", label: "読み" },
  { key: "age", label: "年齢" },
  { key: "gender", label: "性別" },
  { key: "role", label: "立場・職業" },
  { key: "personality", label: "性格", long: true },
  { key: "speech", label: "口調", long: true },
  { key: "background", label: "経歴", long: true },
  { key: "notes", label: "メモ", long: true },
];

/** プロフィール(画像には使わず、ほかのアプリに渡す) */
export function ProfileEditor(props: { profile: Profile; onChange: (p: Profile) => void; disabled?: boolean }) {
  const p = props.profile;
  return (
    <div className="profile">
      {FIELDS.map((f) => (
        <label key={f.key} className={`field${f.long ? " wide" : ""}`}>
          <span>{f.label}</span>
          {f.long ? (
            <textarea rows={2} disabled={props.disabled} value={p[f.key]} onChange={(e) => props.onChange({ ...p, [f.key]: e.target.value })} />
          ) : (
            <input disabled={props.disabled} value={p[f.key]} onChange={(e) => props.onChange({ ...p, [f.key]: e.target.value })} />
          )}
        </label>
      ))}
    </div>
  );
}
