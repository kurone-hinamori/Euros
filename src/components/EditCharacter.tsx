import { useEffect, useMemo, useRef, useState } from "react";
import type { Appearance, AppearanceKey, Box1000, Character, Profile, ReferenceImage, Revision, Settings, SheetOptions } from "../types";
import { APPEARANCE_KEYS, APPEARANCE_LABEL } from "../types";
import { type Candidate, type PendingReference, addRevision, randomSeed, storeReferences } from "../lib/character";
import { engineOf } from "../lib/comfy";
import { applyInstruction, translateFields } from "../lib/prompts";
import { sheetNegative, sheetPrompt } from "../lib/sheet";
import { loadCharacter, loadFile, saveCharacter } from "../lib/storage";
import { useFileUrl } from "../lib/useFileUrl";
import { useImageJob } from "../lib/useImageJob";
import { useLeaveGuard } from "../lib/leaveGuard";
import { AppearanceEditor, type EnSource, sourceOf, staleKeys } from "./AppearanceEditor";
import { ProfileEditor } from "./ProfileEditor";
import { ReferencePicker, USE_LABEL } from "./ReferencePicker";
import { RegionSelector } from "./RegionSelector";
import { SheetOptionsEditor } from "./SheetOptionsEditor";
import { SheetViewer } from "./SheetViewer";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Method = Revision["method"];

const METHODS: { key: Method; label: string; desc: string }[] = [
  { key: "reference", label: "いまのシートを参照して直す", desc: "いまのシートを見せて、変わる所だけを描き直します。全体の雰囲気を保ちやすい方法です。" },
  { key: "redraw", label: "範囲だけ描き直す", desc: "選んだ範囲だけを描き直し、範囲の外はいまのシートのまま残します。" },
  { key: "same_seed", label: "同じ seed で描き直す", desc: "直した説明で、同じ seed から描き直します。構図は近くなりますが、細部は変わります。" },
  { key: "fresh", label: "新しく描く", desc: "直した説明で、別の seed から描き直します。" },
];

/** このセッションで反映した修正指示(取り消せるよう、変える前の値を持つ) */
interface Applied {
  ja: string;
  summaryEn: string;
  before: Partial<Record<AppearanceKey, Appearance[AppearanceKey]>>;
  after: Partial<Record<AppearanceKey, Appearance[AppearanceKey]>>;
}

/** 生成した候補と、その描き方 */
interface EditCandidate {
  c: Candidate;
  method: Method;
  boxes?: Box1000[];
  instructionJa: string;
}

/** 編集:修正指示や外見の直接編集から、シートを描き直して新しい版にする */
export function EditCharacter(props: { id: string; settings: Settings; onDone: (id: string) => void; onCancel: () => void }) {
  const { settings } = props;
  const [ch, setCh] = useState<Character | null>(null);
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  const [from, setFrom] = useState<EnSource>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [style, setStyle] = useState("");
  const [sheet, setSheet] = useState<SheetOptions | null>(null);
  const [refs, setRefs] = useState<ReferenceImage[]>([]);
  const [newRefs, setNewRefs] = useState<PendingReference[]>([]);
  const [useRefs, setUseRefs] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [applied, setApplied] = useState<Applied[]>([]);
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<Method>("reference");
  const [boxes, setBoxes] = useState<Box1000[]>([]);
  const [candidates, setCandidates] = useState<EditCandidate[]>([]);
  const [chosen, setChosen] = useState(-1);
  const [llm, setLlm] = useState<"instruction" | "translate" | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [error, setError] = useState("");
  const llmAbort = useRef<AbortController | null>(null);
  const job = useImageJob(settings);

  useEffect(() => () => llmAbort.current?.abort(), []);

  useEffect(() => {
    loadCharacter(props.id)
      .then((c) => {
        setCh(c);
        setAppearance(structuredClone(c.appearance));
        setFrom(sourceOf(c.appearance));
        setProfile(c.profile);
        setStyle(c.style);
        setSheet(c.sheet);
        setRefs(c.references);
      })
      .catch((e) => setError(`読み込めませんでした:${message(e)}`));
  }, [props.id]);

  const base = ch?.revisions.find((r) => r.id === ch.currentRevision) ?? ch?.revisions[ch.revisions.length - 1];
  const baseUrl = useFileUrl(props.id, base?.image);
  const urls = useMemo(() => candidates.map((x) => URL.createObjectURL(new Blob([x.c.png as BlobPart], { type: "image/png" }))), [candidates]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  useLeaveGuard(
    job.running
      ? "シートを生成しています。画面を離れると生成を中断します。"
      : llm
        ? "Ollama で処理しています。画面を離れると結果は残りません。"
        : candidates.length && !saving
          ? "保存していない候補があります。画面を離れると候補は消えます。"
          : null,
  );

  if (error && !ch) {
    return (
      <div className="page">
        <button className="ghost" onClick={props.onCancel}>
          ← 戻る
        </button>
        <p className="error">{error}</p>
      </div>
    );
  }
  if (!ch || !appearance || !profile || !sheet || !base) return null;

  const busy = !!llm || job.running || saving;
  const engine = engineOf(settings.imageEngine);
  const changedFromBase = APPEARANCE_KEYS.filter((k) => appearance[k].ja !== base.appearance[k].ja || appearance[k].en !== base.appearance[k].en);
  const current = chosen >= 0 ? candidates[chosen] : undefined;

  const runLlm = async <T,>(kind: "instruction" | "translate", f: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    setError("");
    const ctrl = new AbortController();
    llmAbort.current = ctrl;
    setLlm(kind);
    try {
      return await f(ctrl.signal);
    } catch (e) {
      if (!ctrl.signal.aborted) setError(`Ollama で処理できませんでした:${message(e)}`);
      return null;
    } finally {
      setLlm(null);
    }
  };

  /** 修正指示を外見に反映する(英語もここで作るので、訳し直しはいらない) */
  const apply = async () => {
    const text = instruction.trim();
    if (!text) return;
    setNote("");
    const r = await runLlm("instruction", (signal) => applyInstruction(settings, appearance, text, signal));
    if (!r) return;
    const keys = Object.keys(r.changes) as AppearanceKey[];
    if (!keys.length) {
      setNote(r.note || "外見の設定では直す所が見つかりませんでした。指示を具体的にしてみてください。");
      return;
    }
    const next = { ...appearance };
    const before: Applied["before"] = {};
    for (const k of keys) {
      before[k] = appearance[k];
      next[k] = r.changes[k]!;
    }
    setAppearance(next);
    setFrom({ ...from, ...Object.fromEntries(keys.map((k) => [k, next[k].ja])) });
    setApplied([...applied, { ja: text, summaryEn: r.summaryEn, before, after: r.changes }]);
    setInstruction("");
    if (r.note) setNote(r.note);
  };

  /** 反映した指示を取り消す(後から直した項目は、そのままにする) */
  const undo = (i: number) => {
    const a = applied[i];
    const next = { ...appearance };
    for (const [k, v] of Object.entries(a.before) as [AppearanceKey, Appearance[AppearanceKey]][]) {
      if (next[k].ja === a.after[k]?.ja) next[k] = v;
    }
    setAppearance(next);
    setFrom({ ...from, ...Object.fromEntries(Object.keys(a.before).map((k) => [k, next[k as AppearanceKey].ja])) });
    setApplied(applied.filter((_, j) => j !== i));
  };

  const translate = async (a: Appearance): Promise<Appearance | null> => {
    const keys = staleKeys(a, from);
    if (!keys.length) return a;
    const en = await runLlm("translate", (signal) => translateFields(settings, a, keys, signal));
    if (!en) return null;
    const next = { ...a };
    for (const k of keys) next[k] = { ...a[k], en: en[k] ?? a[k].en };
    setAppearance(next);
    setFrom(sourceOf(next));
    return next;
  };

  const generate = async () => {
    setError("");
    if (method === "redraw" && !boxes.length) {
      setError("描き直す範囲を選んでください。");
      return;
    }
    const a = await translate(appearance);
    if (!a || !base.image) return;
    let baseBytes: Uint8Array;
    let savedRefBytes: { r: ReferenceImage; bytes: Uint8Array }[] = [];
    try {
      baseBytes = await loadFile(ch.id, base.image);
      if (useRefs) savedRefBytes = await Promise.all(refs.map(async (r) => ({ r, bytes: await loadFile(ch.id, r.file) })));
    } catch (e) {
      setError(`いまのシートを読めませんでした:${message(e)}`);
      return;
    }
    const [width, height] = [base.width, base.height];
    const changesEn = [
      ...applied.map((x) => x.summaryEn).filter(Boolean),
      // 指示ではなく直接直した項目も伝える
      ...changedFromBase.filter((k) => !applied.some((x) => k in x.after)).map((k) => `${k}: ${a[k].en}`),
      // 画風と表情を変えたときも伝える(MOSS-Image で直すときは、変える所しか伝えないため)
      ...(style.trim() !== ch.style.trim() ? [`art style: ${style}`] : []),
      ...(JSON.stringify(sheet.expressions) !== JSON.stringify(ch.sheet.expressions)
        ? [`expressions in the face grid: ${sheet.expressions.map((e) => e.en.trim()).filter(Boolean).join(", ")}`]
        : []),
    ];
    let used: Method = method;
    let prompt = "";
    let negative = "";
    let refIds: string[] = [];
    let seed = randomSeed();
    const r = await job.run((models) => {
      const def = engineOf(models.engine);
      const canRef = def.canReference(models);
      // 参照できないモデルでは、同じ seed で描き直す
      used = method === "reference" && !canRef ? "same_seed" : method;
      seed = used === "same_seed" ? base.seed : randomSeed();
      const extra =
        canRef && used !== "redraw"
          ? [...savedRefBytes.map((x) => ({ id: x.r.id, use: x.r.use, name: x.r.file.split("/").pop()!, bytes: x.bytes })), ...newRefs.map((x) => ({ id: x.id, use: x.use, name: `${x.id}.${x.ext}`, bytes: x.bytes }))]
          : [];
      const withBase = used === "reference";
      prompt = sheetPrompt({ style, appearance: a, sheet, references: extra, base: withBase ? { changes: changesEn } : undefined }, def);
      negative = def.negative ? sheetNegative(sheet) : "";
      refIds = [...(withBase ? [`sheet:${base.id}`] : []), ...extra.map((x) => x.id)];
      const baseImage = { name: `${ch.id}-${base.id}.png`, bytes: baseBytes };
      return {
        prompt,
        negative: negative || undefined,
        width,
        height,
        seed,
        references: [...(withBase ? [baseImage] : []), ...extra.map((x) => ({ name: x.name, bytes: x.bytes }))],
        redraw: used === "redraw" ? { ...baseImage, boxes } : undefined,
      };
    });
    if (!r) return;
    const c: Candidate = {
      png: r.png,
      appearance: a,
      prompt,
      negative,
      engine: r.models.engine,
      models: r.models,
      seed,
      width,
      height,
      references: refIds,
      workflow: r.workflow,
      createdAt: new Date().toISOString(),
    };
    setCandidates([...candidates, { c, method: used, boxes: used === "redraw" ? boxes : undefined, instructionJa: applied.map((x) => x.ja).join("／") }]);
    setChosen(candidates.length);
  };

  /** プロフィール・画風・表情・参照画像を保存する(シートは変えない) */
  const saveInfo = async (): Promise<Character | null> => {
    setSaving(true);
    setError("");
    try {
      const stored = await storeReferences(ch.id, newRefs);
      const next: Character = { ...ch, updatedAt: new Date().toISOString(), profile, style, sheet, references: [...refs, ...stored] };
      await saveCharacter(next);
      setCh(next);
      setRefs(next.references);
      setNewRefs([]);
      return next;
    } catch (e) {
      setError(`保存できませんでした:${message(e)}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  /** 候補を新しい版として採用して保存する */
  const adopt = async () => {
    if (!current) return;
    const info = await saveInfo();
    if (!info) return;
    setSaving(true);
    try {
      const changes = APPEARANCE_KEYS.filter((k) => current.c.appearance[k].ja !== base.appearance[k].ja || current.c.appearance[k].en !== base.appearance[k].en).map((k) => ({
        key: k,
        before: base.appearance[k],
        after: current.c.appearance[k],
      }));
      await addRevision(info, current.c, {
        kind: current.method === "redraw" ? "redraw" : current.instructionJa ? "instruction" : "manual",
        parentId: base.id,
        instructionJa: current.instructionJa || undefined,
        changes,
        method: current.method,
        boxes: current.boxes,
      });
      props.onDone(ch.id);
    } catch (e) {
      setError(`保存できませんでした:${message(e)}`);
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <button className="ghost" onClick={props.onCancel} disabled={saving}>
          ← 詳細
        </button>
        <h2>{profile.name || "(名前なし)"} の編集</h2>
      </header>

      <section className="card">
        <h3>修正指示</h3>
        <div className="row">
          <input
            style={{ flex: 1, minWidth: 260 }}
            disabled={busy}
            placeholder="例)前髪をもう少し長く / 肌の色をもう少し明るく / 身長をもう少し低く"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void apply()}
          />
          <button className="primary" disabled={busy || !instruction.trim()} onClick={() => void apply()}>
            反映する
          </button>
          {llm === "instruction" && (
            <>
              <span className="muted">Ollama で考えています…</span>
              <button className="small" onClick={() => llmAbort.current?.abort()}>
                中断
              </button>
            </>
          )}
        </div>
        {note && <p className="muted" style={{ marginTop: 0 }}>{note}</p>}
        {applied.length > 0 && (
          <div className="applied">
            {applied.map((a, i) => (
              <div key={i} className="applied-item">
                <div className="row" style={{ marginBottom: 4 }}>
                  <strong>「{a.ja}」</strong>
                  <button className="small ghost" disabled={busy} onClick={() => undo(i)}>
                    取り消す
                  </button>
                </div>
                <table className="diff">
                  <tbody>
                    {(Object.keys(a.after) as AppearanceKey[]).map((k) => (
                      <tr key={k}>
                        <th>{APPEARANCE_LABEL[k]}</th>
                        <td>{a.before[k]?.ja}</td>
                        <td>→</td>
                        <td>{a.after[k]?.ja}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
        <p className="muted small-text" style={{ margin: "8px 0 0" }}>
          指示はいくつでも重ねられます。反映した内容は下の「外見」でも直せます。
          {changedFromBase.length > 0 && ` いまのシートから変わる項目:${changedFromBase.map((k) => APPEARANCE_LABEL[k]).join("、")}`}
        </p>
      </section>

      <section className="card">
        <h3>描き直し</h3>
        <div className="methods">
          {METHODS.map((m) => (
            <label key={m.key} className={`method${method === m.key ? " active" : ""}`}>
              <input type="radio" name="method" disabled={busy} checked={method === m.key} onChange={() => setMethod(m.key)} />
              <span>
                <strong>{m.label}</strong>
                <span className="muted small-text">{m.desc}</span>
              </span>
            </label>
          ))}
        </div>
        {method === "reference" && engine.id === "moss" && <p className="muted small-text">MOSS-Image では Edit LoRA が必要です。ない場合は「同じ seed で描き直す」になります。</p>}

        {method === "redraw" ? (
          <RegionSelector src={baseUrl} boxes={boxes} onChange={setBoxes} disabled={busy} />
        ) : (
          <SheetViewer src={current ? urls[chosen] : baseUrl} />
        )}

        <div className="row" style={{ marginTop: 12 }}>
          {job.running ? (
            <button onClick={job.cancel}>中断</button>
          ) : (
            <button className="primary" disabled={busy} onClick={() => void generate()}>
              {candidates.length ? "もう1枚作る" : "描き直す"}
            </button>
          )}
          <span className="muted">
            {engine.label} · 版 {ch.revisions.indexOf(base) + 1} から
          </span>
          {job.state.kind === "running" && <span className="muted">{job.state.text}</span>}
          {job.state.kind === "cancelled" && <span className="muted">中断しました</span>}
          {job.state.kind === "error" && <span className="error">{job.state.message}</span>}
        </div>

        {candidates.length > 0 && (
          <>
            <div className="candidates">
              <button className={`candidate${chosen < 0 ? " active" : ""}`} onClick={() => setChosen(-1)} title="いまのシート">
                {baseUrl && <img src={baseUrl} alt="いまのシート" />}
              </button>
              {urls.map((u, i) => (
                <button key={u} className={`candidate${i === chosen ? " active" : ""}`} onClick={() => setChosen(i)}>
                  <img src={u} alt={`候補 ${i + 1}`} />
                </button>
              ))}
            </div>
            {method === "redraw" && current && <SheetViewer src={urls[chosen]} />}
            {current && (
              <details className="prompt">
                <summary>
                  候補 {chosen + 1} のプロンプト({METHODS.find((m) => m.key === current.method)?.label} · seed {current.c.seed})
                </summary>
                <pre className="mono">{current.c.prompt}</pre>
              </details>
            )}
            <div className="row" style={{ marginTop: 12, marginBottom: 0 }}>
              <button className="primary" disabled={busy || !current} onClick={() => void adopt()}>
                {saving ? "保存しています…" : current ? `候補 ${chosen + 1} を新しい版として保存` : "候補を選んでください"}
              </button>
            </div>
          </>
        )}
      </section>

      <details className="card">
        <summary>
          <h3 style={{ display: "inline" }}>外見</h3>
          <span className="muted"> — 説明を直接直す</span>
        </summary>
        <div style={{ marginTop: 12 }}>
          <AppearanceEditor
            appearance={appearance}
            from={from}
            disabled={busy}
            translating={llm === "translate"}
            onChange={(a, f) => {
              setAppearance(a);
              setFrom(f);
            }}
            onTranslate={() => void translate(appearance)}
          />
        </div>
      </details>

      <details className="card">
        <summary>
          <h3 style={{ display: "inline" }}>シートの設定</h3>
        </summary>
        <div style={{ marginTop: 12 }}>
          <SheetOptionsEditor
            style={style}
            sheet={sheet}
            disabled={busy}
            onChange={(st, sh) => {
              setStyle(st);
              setSheet(sh);
            }}
          />
        </div>
      </details>

      <details className="card">
        <summary>
          <h3 style={{ display: "inline" }}>参照画像</h3>
          <span className="muted"> — {refs.length + newRefs.length} 枚</span>
        </summary>
        <div style={{ marginTop: 12 }}>
          {refs.length > 0 && (
            <div className="refs" style={{ marginBottom: 10 }}>
              {refs.map((r) => (
                <SavedRef
                  key={r.id}
                  characterId={ch.id}
                  r={r}
                  disabled={busy}
                  onChange={(n) => setRefs(refs.map((x) => (x.id === r.id ? n : x)))}
                  onRemove={() => setRefs(refs.filter((x) => x.id !== r.id))}
                />
              ))}
            </div>
          )}
          <ReferencePicker refs={newRefs} onChange={setNewRefs} disabled={busy} />
          <label className="check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={useRefs} disabled={busy} onChange={(e) => setUseRefs(e.target.checked)} />
            描き直すときに、登録済みの参照画像も使う(新しく足した画像はいつも使います)
          </label>
        </div>
      </details>

      <details className="card">
        <summary>
          <h3 style={{ display: "inline" }}>プロフィール</h3>
        </summary>
        <div style={{ marginTop: 12 }}>
          <ProfileEditor profile={profile} onChange={setProfile} disabled={busy} />
        </div>
      </details>

      <div className="row">
        <button disabled={busy} onClick={() => void saveInfo().then((c) => c && setSavedMsg("保存しました"))}>
          プロフィール・設定・参照画像を保存
        </button>
        <span className="muted small-text">{savedMsg || "シートは変えずに保存します。外見の変更は、描き直して新しい版にしたときに保存されます。"}</span>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

function SavedRef(props: { characterId: string; r: ReferenceImage; disabled: boolean; onChange: (r: ReferenceImage) => void; onRemove: () => void }) {
  const url = useFileUrl(props.characterId, props.r.file);
  return (
    <div className="ref">
      {url ? <img src={url} alt={props.r.label} /> : <div className="noimage" />}
      <div className="ref-meta">
        <div className="ref-name" title={props.r.label}>
          {props.r.label}
        </div>
        <select disabled={props.disabled} value={props.r.use} onChange={(e) => props.onChange({ ...props.r, use: e.target.value as ReferenceImage["use"] })}>
          {Object.entries(USE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="small ghost" disabled={props.disabled} onClick={props.onRemove}>
          外す(ファイルは残します)
        </button>
      </div>
    </div>
  );
}
