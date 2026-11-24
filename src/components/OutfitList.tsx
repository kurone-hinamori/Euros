import { useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { Appearance, Outfit, Settings } from "../types";
import { readReference } from "../lib/character";
import { OUTFIT_KEYS, createOutfit, outfitAppearance, setOutfitImage } from "../lib/outfits";
import { translateFields } from "../lib/prompts";
import { randomSeed } from "../lib/character";
import { engineOf } from "../lib/comfy";
import { OUTFIT_IMAGE_SIZE, STYLE_PRESETS, outfitImageNegative, outfitImagePrompt } from "../lib/sheet";
import { useImageJob } from "../lib/useImageJob";
import { deleteOutfit, listOutfits, saveOutfit } from "../lib/storage";
import { useFileUrl } from "../lib/useFileUrl";
import { confirmLeave, useLeaveGuard } from "../lib/leaveGuard";
import { AppearanceEditor, type EnSource, sourceOf, staleKeys } from "./AppearanceEditor";
import { OutfitThumb } from "./OutfitPicker";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 衣装の一覧。選んだ衣装を直したり、新しく登録したりする */
export function OutfitList(props: { settings: Settings }) {
  const [list, setList] = useState<Outfit[] | null>(null);
  const [error, setError] = useState("");
  /** 直している衣装(null は新しく登録する) */
  const [editing, setEditing] = useState<Outfit | null | undefined>();

  const reload = () =>
    listOutfits()
      .then(setList)
      .catch((e) => {
        setList([]);
        setError(`衣装を読めませんでした:${String(e)}`);
      });
  useEffect(() => {
    void reload();
  }, [props.settings.libraryDir]);

  return (
    <div className="page">
      <header className="page-head">
        <h2>衣装</h2>
        <div className="grow" />
        <button className="primary" disabled={editing !== undefined} onClick={() => setEditing(null)}>
          新しく登録
        </button>
      </header>
      <p className="muted small-text" style={{ marginTop: 0 }}>
        登録した衣装は、新規作成や編集の画面でほかのキャラクターに着せられます。衣装と小物の説明を書き換え、見本の画像を「衣装と小物だけ」の参照画像として使います。
      </p>
      {error && <p className="error">{error}</p>}

      {editing !== undefined && (
        <OutfitEditor
          key={editing?.id ?? "new"}
          settings={props.settings}
          outfit={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void reload();
          }}
        />
      )}

      {list === null ? null : list.length === 0 ? (
        editing === undefined && (
          <div className="empty">
            <div>まだ衣装を登録していません。キャラクターの詳細画面の「衣装を登録」で、シートから登録することもできます。</div>
          </div>
        )
      ) : (
        <div className="grid">
          {list.map((o) => (
            <button key={o.id} className="tile outfit-tile" disabled={editing !== undefined} onClick={() => setEditing(o)}>
              <OutfitThumb o={o} />
              <div className="meta">
                <div className="name">{o.name}</div>
                <div className="sub">{[o.outfit.ja, o.accessories.ja].filter(Boolean).join(" / ")}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 1つの衣装を直す(outfit が null なら新しく登録する) */
function OutfitEditor(props: { settings: Settings; outfit: Outfit | null; onClose: () => void; onSaved: () => void }) {
  const o = props.outfit;
  const [name, setName] = useState(o?.name ?? "");
  const [appearance, setAppearance] = useState<Appearance>(() => outfitAppearance(o ?? { outfit: { ja: "", en: "" }, accessories: { ja: "", en: "" } }));
  const [from, setFrom] = useState<EnSource>(() => sourceOf(appearance));
  /** 入れ替えた画像(null は外した、undefined は変えていない) */
  const [image, setImage] = useState<{ bytes: Uint8Array; ext: string; url: string } | null | undefined>();
  const [busy, setBusy] = useState<"translate" | "generate" | "save" | null>(null);
  /** 説明から画像を作るときの画風 */
  const [style, setStyle] = useState(STYLE_PRESETS[0].en);
  const job = useImageJob(props.settings);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const savedUrl = useFileUrl(o?.id ?? "", o?.image, "outfits");
  const shownUrl = image === undefined ? savedUrl : image?.url;

  useEffect(
    () => () => {
      if (image?.url) URL.revokeObjectURL(image.url);
    },
    [image],
  );

  const dirty = image !== undefined || name !== (o?.name ?? "") || OUTFIT_KEYS.some((k) => appearance[k].ja !== (o?.[k].ja ?? "") || appearance[k].en !== (o?.[k].en ?? ""));
  useLeaveGuard(dirty && busy !== "save" ? "保存していない衣装の変更があります。画面を離れると変更は消えます。" : null);

  const pickFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      const r = await readReference(f);
      setImage({ bytes: r.bytes, ext: r.ext, url: URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: f.type || "image/png" })) });
    } catch (e) {
      setError(message(e));
    }
  };

  /** 日本語を直した項目を英語にする */
  const translate = async (): Promise<Appearance | null> => {
    const keys = staleKeys(appearance, from);
    if (!keys.length) return appearance;
    setBusy("translate");
    setError("");
    try {
      const en = await translateFields(props.settings, appearance, keys);
      const next = { ...appearance };
      for (const k of keys) next[k] = { ...appearance[k], en: en[k] ?? appearance[k].en };
      setAppearance(next);
      setFrom(sourceOf(next));
      return next;
    } catch (e) {
      setError(`英語に訳せませんでした:${message(e)}`);
      return null;
    } finally {
      setBusy(null);
    }
  };

  /** 衣装と小物の説明から、人が着ていない衣装だけの画像を作る */
  const generate = async () => {
    setError("");
    const a = await translate();
    if (!a) return;
    if (!OUTFIT_KEYS.some((k) => a[k].en.trim())) {
      setError("衣装か小物の説明を書いてください。");
      return;
    }
    setBusy("generate");
    try {
      const [width, height] = OUTFIT_IMAGE_SIZE;
      const seed = randomSeed();
      const r = await job.run((models) => {
        const def = engineOf(models.engine);
        return { prompt: outfitImagePrompt(a, style, def), negative: def.negative ? outfitImageNegative() : undefined, width, height, seed, references: [] };
      });
      if (r) setImage({ bytes: r.png, ext: "png", url: URL.createObjectURL(new Blob([r.png as BlobPart], { type: "image/png" })) });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setError("");
    const a = await translate();
    if (!a) return;
    if (!OUTFIT_KEYS.some((k) => a[k].en.trim())) {
      setError("衣装か小物の説明を書いてください。");
      return;
    }
    setBusy("save");
    try {
      if (!o) {
        await createOutfit({ name, outfit: a.outfit, accessories: a.accessories, image: image ?? undefined });
      } else {
        let next: Outfit = { ...o, name: name.trim() || o.name, outfit: a.outfit, accessories: a.accessories, updatedAt: new Date().toISOString() };
        // 前の画像のファイルは残す(ほかで使っていないかを確かめずに消さない)
        if (image !== undefined) next = await setOutfitImage(next, image);
        await saveOutfit(next);
      }
      props.onSaved();
    } catch (e) {
      setError(`保存できませんでした:${message(e)}`);
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!o) return;
    const ok = await ask(`衣装「${o.name}」を削除しますか?\n保存先の .trash フォルダーに移します(そこから戻せます)。着せたキャラクターは変わりません。`, { title: "削除", kind: "warning" });
    if (!ok) return;
    try {
      await deleteOutfit(o.id);
      props.onSaved();
    } catch (e) {
      setError(`削除できませんでした:${message(e)}`);
    }
  };

  return (
    <section className="card">
      <h3>{o ? `「${o.name}」を直す` : "衣装を新しく登録"}</h3>
      <div className="outfit-edit">
        <div
          className="outfit-image"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void pickFile(e.dataTransfer.files);
          }}
        >
          {shownUrl ? <img src={shownUrl} alt="見本" /> : <div className="noimage">画像をここにドロップ</div>}
          <div className="row" style={{ margin: "8px 0 0" }}>
            <button className="small" disabled={!!busy} onClick={() => input.current?.click()}>
              画像を選ぶ
            </button>
            {shownUrl && (
              <button className="small ghost" disabled={!!busy} onClick={() => setImage(null)}>
                画像を外す
              </button>
            )}
          </div>
          <div className="field" style={{ margin: "8px 0 0" }}>
            <span>説明から画像を作る</span>
            <select disabled={!!busy} value={style} onChange={(e) => setStyle(e.target.value)}>
              {STYLE_PRESETS.map((p) => (
                <option key={p.en} value={p.en}>
                  {p.label}
                </option>
              ))}
            </select>
            <div className="row" style={{ margin: "6px 0 0" }}>
              {busy === "generate" ? (
                <button className="small" onClick={job.cancel}>
                  中断
                </button>
              ) : (
                <button className="small" disabled={!!busy} onClick={() => void generate()}>
                  {shownUrl ? "作り直す" : "画像を作る"}
                </button>
              )}
            </div>
            {job.state.kind === "running" && <span className="muted small-text">{job.state.text}</span>}
            {job.state.kind === "cancelled" && <span className="muted small-text">中断しました</span>}
            {job.state.kind === "error" && <span className="error small-text">{job.state.message}</span>}
          </div>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void pickFile(e.target.files).then(() => (e.target.value = ""))} />
          <p className="muted small-text">人が着ていない衣装だけの絵が、ほかのキャラクターに着せやすい見本になります。「画像を作る」は、右の衣装と小物の説明から ComfyUI で描きます。</p>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label className="field">
            <span>名前</span>
            <input disabled={!!busy} placeholder="例)星見学園の制服" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <AppearanceEditor
            keys={OUTFIT_KEYS}
            appearance={appearance}
            from={from}
            disabled={!!busy}
            translating={busy === "translate"}
            onChange={(a, f) => {
              setAppearance(a);
              setFrom(f);
            }}
            onTranslate={() => void translate()}
          />
        </div>
      </div>
      <div className="row" style={{ marginBottom: 0 }}>
        <button className="primary" disabled={!!busy} onClick={() => void save()}>
          {busy === "save" ? "保存しています…" : busy === "translate" ? "英語に訳しています…" : busy === "generate" ? "画像を作っています…" : o ? "保存" : "登録する"}
        </button>
        <button disabled={busy === "save"} onClick={() => void confirmLeave().then((ok) => ok && props.onClose())}>
          やめる
        </button>
        <div style={{ flex: 1 }} />
        {o && (
          <button disabled={!!busy} onClick={() => void remove()}>
            削除
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
