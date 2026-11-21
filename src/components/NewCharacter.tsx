import { useEffect, useMemo, useRef, useState } from "react";
import type { Appearance, Outfit, Profile, Settings, SheetOptions } from "../types";
import { type Candidate, type PendingReference, comfyName, createCharacter, emptyProfile, randomSeed } from "../lib/character";
import { engineOf } from "../lib/comfy";
import { outfitReference, wearOutfit } from "../lib/outfits";
import { structureCharacter, translateFields } from "../lib/prompts";
import { DEFAULT_SHEET, SHEET_SIZE, STYLE_PRESETS, sheetNegative, sheetPrompt } from "../lib/sheet";
import { useImageJob } from "../lib/useImageJob";
import { useLeaveGuard } from "../lib/leaveGuard";
import { AppearanceEditor, type EnSource, sourceOf, staleKeys } from "./AppearanceEditor";
import { ProfileEditor } from "./ProfileEditor";
import { OutfitPicker } from "./OutfitPicker";
import { ReferencePicker } from "./ReferencePicker";
import { SheetOptionsEditor } from "./SheetOptionsEditor";
import { SheetViewer } from "./SheetViewer";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 新規作成:日本語の説明 → 外見の整理(Ollama) → シートの生成(ComfyUI) → 採用して保存 */
export function NewCharacter(props: { settings: Settings; onCreated: (id: string) => void }) {
  const { settings } = props;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [refs, setRefs] = useState<PendingReference[]>([]);
  /** 着せる衣装と、その見本から足した参照画像 */
  const [wear, setWear] = useState<{ outfit: Outfit; refId?: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  const [from, setFrom] = useState<EnSource>({});
  const [style, setStyle] = useState(STYLE_PRESETS[0].en);
  const [sheet, setSheet] = useState<SheetOptions>(DEFAULT_SHEET);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState(0);
  const [llm, setLlm] = useState<{ kind: "structure" | "translate" } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const llmAbort = useRef<AbortController | null>(null);
  const job = useImageJob(settings);

  useEffect(() => () => llmAbort.current?.abort(), []);

  const busy = !!llm || job.running || saving;
  useLeaveGuard(
    job.running
      ? "シートを生成しています。画面を離れると生成を中断します。"
      : llm
        ? "Ollama で処理しています。画面を離れると結果は残りません。"
        : candidates.length && !saving
          ? "保存していない候補があります。画面を離れると候補は消えます。"
          : null,
  );
  const engine = engineOf(settings.imageEngine);

  const structure = async () => {
    setError("");
    const ctrl = new AbortController();
    llmAbort.current = ctrl;
    setLlm({ kind: "structure" });
    try {
      const out = await structureCharacter(settings, { name, description, references: refs.map((r) => r.label) }, ctrl.signal);
      setProfile({ ...emptyProfile(), ...out.profile });
      // 衣装を選んでいれば、整理した衣装・小物より優先する
      const a = wear ? wearOutfit(out.appearance, wear.outfit).next : out.appearance;
      setAppearance(a);
      setFrom(sourceOf(a));
      setSheet((s) => ({ ...s, notHuman: out.notHuman }));
    } catch (e) {
      if (!ctrl.signal.aborted) setError(`外見を整理できませんでした:${message(e)}`);
    } finally {
      setLlm(null);
    }
  };

  /** 日本語を直した項目の英語を作り直す。作り直した外見を返す */
  const translate = async (a: Appearance): Promise<Appearance | null> => {
    const keys = staleKeys(a, from);
    if (!keys.length) return a;
    const ctrl = new AbortController();
    llmAbort.current = ctrl;
    setLlm({ kind: "translate" });
    try {
      const en = await translateFields(settings, a, keys, ctrl.signal);
      const next = { ...a };
      for (const k of keys) next[k] = { ...a[k], en: en[k] ?? a[k].en };
      setAppearance(next);
      setFrom(sourceOf(next));
      return next;
    } catch (e) {
      if (!ctrl.signal.aborted) setError(`英語に訳せませんでした:${message(e)}`);
      return null;
    } finally {
      setLlm(null);
    }
  };

  /** 登録した衣装を着せる(前に選んだ衣装の参照画像は外す) */
  const pickOutfit = async (o: Outfit) => {
    setError("");
    let ref: PendingReference | null = null;
    try {
      ref = await outfitReference(o);
    } catch (e) {
      setError(`衣装の画像を読めませんでした(説明だけを使います):${message(e)}`);
    }
    const rest = refs.filter((r) => r.id !== wear?.refId);
    setRefs(ref ? [...rest, ref] : rest);
    setWear({ outfit: o, refId: ref?.id });
    if (appearance) {
      const next = wearOutfit(appearance, o).next;
      setAppearance(next);
      setFrom({ ...from, outfit: next.outfit.ja, accessories: next.accessories.ja });
    }
  };

  const takeOff = () => {
    setRefs(refs.filter((r) => r.id !== wear?.refId));
    setWear(null);
  };

  const generate = async () => {
    if (!appearance) return;
    setError("");
    // 日本語を直したまま生成すると古い英語で描かれるので、先に訳す
    const a = await translate(appearance);
    if (!a) return;
    const seed = randomSeed();
    const [width, height] = SHEET_SIZE;
    let used: PendingReference[] = [];
    let prompt = "";
    let negative = "";
    const r = await job.run((models) => {
      const def = engineOf(models.engine);
      used = def.canReference(models) ? refs : [];
      prompt = sheetPrompt({ style, appearance: a, sheet, references: used }, def);
      negative = def.negative ? sheetNegative(sheet) : "";
      return { prompt, negative: negative || undefined, width, height, seed, references: used.map((x) => ({ name: comfyName(x), bytes: x.bytes })) };
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
      references: used.map((x) => x.id),
      workflow: r.workflow,
      createdAt: new Date().toISOString(),
    };
    setCandidates([...candidates, c]);
    setChosen(candidates.length);
  };

  const save = async () => {
    const c = candidates[chosen];
    if (!c || !profile || !appearance) return;
    setSaving(true);
    setError("");
    try {
      // 外見は、採用した候補を描いたときのものを保存する(シートと外見の説明を食い違わせない)
      const ch = await createCharacter({ profile, sourceJa: description, style, sheet, references: refs, chosen: c });
      props.onCreated(ch.id);
    } catch (e) {
      setError(`保存できませんでした:${message(e)}`);
      setSaving(false);
    }
  };

  const urls = useMemo(() => candidates.map((c) => URL.createObjectURL(new Blob([c.png as BlobPart], { type: "image/png" }))), [candidates]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const refWarning =
    engine.id === "moss" ? "MOSS-Image で参照画像を使うには Edit LoRA が必要です(設定の画面で確認できます)。ない場合、参照画像は使わずに描きます。" : undefined;
  const current = candidates[chosen];

  return (
    <div className="page">
      <header className="page-head">
        <h2>新規作成</h2>
      </header>

      <section className="card">
        <h3>説明</h3>
        <label className="field">
          <span>名前(空なら説明から考えます)</span>
          <input disabled={busy} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>どんなキャラクターか(日本語で自由に)</span>
          <textarea
            rows={5}
            disabled={busy}
            placeholder="例)17歳の女子高生。黒髪のロングヘアで前髪ぱっつん。赤い瞳。紺色のセーラー服に赤いリボン。古い懐中時計を首から下げている。"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="field">
          <span>参照画像(任意)</span>
          <ReferencePicker refs={refs} onChange={setRefs} disabled={busy} warning={refWarning} />
        </div>
        <div className="field">
          <span>登録した衣装(任意)</span>
          {wear && (
            <div className="row" style={{ marginBottom: 6 }}>
              <strong>{wear.outfit.name}</strong>
              <span className="muted small-text">{wear.refId ? "衣装と小物の説明を書き換え、見本の画像を参照します" : "衣装と小物の説明を書き換えます(見本の画像はありません)"}</span>
              <button className="small ghost" disabled={busy} onClick={takeOff}>
                外す
              </button>
            </div>
          )}
          <OutfitPicker label={wear ? "ほかの衣装にする" : "衣装を選ぶ"} disabled={busy} onPick={(o) => void pickOutfit(o)} />
        </div>
        <div className="row" style={{ marginBottom: 0 }}>
          <button className={appearance ? "" : "primary"} disabled={busy || !description.trim()} onClick={() => void structure()}>
            {appearance ? "説明から整理し直す" : "外見を整理する"}
          </button>
          {llm?.kind === "structure" && (
            <>
              <span className="muted">Ollama で整理しています…</span>
              <button className="small" onClick={() => llmAbort.current?.abort()}>
                中断
              </button>
            </>
          )}
          {!settings.model && <span className="error">設定の画面で Ollama のモデルを選んでください</span>}
        </div>
      </section>

      {appearance && profile && (
        <>
          <section className="card">
            <h3>外見</h3>
            <AppearanceEditor
              appearance={appearance}
              from={from}
              disabled={busy}
              translating={llm?.kind === "translate"}
              onChange={(a, f) => {
                setAppearance(a);
                setFrom(f);
              }}
              onTranslate={() => void translate(appearance)}
            />
          </section>

          <section className="card">
            <h3>シートの設定</h3>
            <SheetOptionsEditor
              style={style}
              sheet={sheet}
              disabled={busy}
              onChange={(st, sh) => {
                setStyle(st);
                setSheet(sh);
              }}
            />
          </section>

          <details className="card">
            <summary>
              <h3 style={{ display: "inline" }}>プロフィール</h3>
              <span className="muted"> — 画像には使わず、ほかのアプリに渡します</span>
            </summary>
            <div style={{ marginTop: 12 }}>
              <ProfileEditor profile={profile} onChange={setProfile} disabled={busy} />
            </div>
          </details>

          <section className="card">
            <h3>キャラクターシート</h3>
            <div className="row">
              {job.running ? (
                <button onClick={job.cancel}>中断</button>
              ) : (
                <button className={candidates.length ? "" : "primary"} disabled={busy} onClick={() => void generate()}>
                  {candidates.length ? "もう1枚作る" : "シートを生成"}
                </button>
              )}
              <span className="muted">
                {engine.label} · {SHEET_SIZE[0]}×{SHEET_SIZE[1]}
              </span>
              {job.state.kind === "running" && <span className="muted">{job.state.text}</span>}
              {job.state.kind === "cancelled" && <span className="muted">中断しました</span>}
              {job.state.kind === "error" && <span className="error">{job.state.message}</span>}
            </div>
            {candidates.length > 0 && (
              <>
                {candidates.length > 1 && (
                  <div className="candidates">
                    {urls.map((u, i) => (
                      <button key={u} className={`candidate${i === chosen ? " active" : ""}`} onClick={() => setChosen(i)}>
                        <img src={u} alt={`候補 ${i + 1}`} />
                      </button>
                    ))}
                  </div>
                )}
                <SheetViewer src={urls[chosen]} />
                {current && (
                  <details className="prompt">
                    <summary>この候補のプロンプト(seed {current.seed})</summary>
                    <pre className="mono">{current.prompt}</pre>
                    {current.negative && <pre className="mono">否定:{current.negative}</pre>}
                  </details>
                )}
                <div className="row" style={{ marginTop: 12, marginBottom: 0 }}>
                  <button className="primary" disabled={busy} onClick={() => void save()}>
                    {saving ? "保存しています…" : candidates.length > 1 ? `候補 ${chosen + 1} を採用して保存` : "このシートで保存"}
                  </button>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
