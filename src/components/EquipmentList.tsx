import { useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { Appearance, Equipment, EquipmentCategory, Settings } from "../types";
import { EQUIPMENT_CATEGORIES, EQUIPMENT_CATEGORY_LABEL } from "../types";
import { emptyAppearance, randomSeed, readReference } from "../lib/character";
import { engineOf } from "../lib/comfy";
import { createEquipment, setEquipmentImage } from "../lib/equipment";
import { translateFields } from "../lib/prompts";
import { EQUIPMENT_IMAGE_SIZE, STYLE_PRESETS, equipmentImageNegative, equipmentImagePrompt } from "../lib/sheet";
import { deleteEquipment, listEquipment, loadFile, saveEquipment } from "../lib/storage";
import { useFileUrl } from "../lib/useFileUrl";
import { useImageJob } from "../lib/useImageJob";
import { confirmLeave, useLeaveGuard } from "../lib/leaveGuard";
import { AppearanceEditor, type EnSource, sourceOf, staleKeys } from "./AppearanceEditor";
import { EquipmentPicker, EquipmentThumb } from "./EquipmentPicker";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const KEYS = ["equipment"] as const;

/** 装備品の一覧。選んだ装備品を直したり、新しく登録したりする */
export function EquipmentList(props: { settings: Settings }) {
  const [list, setList] = useState<Equipment[] | null>(null);
  const [error, setError] = useState("");
  /** 直している装備品(null は新しく登録する) */
  const [editing, setEditing] = useState<Equipment | null | undefined>();
  /** 新しく登録するときに似せる装備品(一覧の「これを元に作る」から) */
  const [basedOn, setBasedOn] = useState<Equipment | undefined>();

  const reload = () =>
    listEquipment()
      .then(setList)
      .catch((e) => {
        setList([]);
        setError(`装備品を読めませんでした:${String(e)}`);
      });
  useEffect(() => {
    void reload();
  }, [props.settings.libraryDir]);

  return (
    <div className="page">
      <header className="page-head">
        <h2>装備品</h2>
        <div className="grow" />
        <button
          className="primary"
          disabled={editing !== undefined}
          onClick={() => {
            setBasedOn(undefined);
            setEditing(null);
          }}
        >
          新しく登録
        </button>
      </header>
      <p className="muted small-text" style={{ marginTop: 0 }}>
        武器・盾・杖など、手に持つ物を登録します。新規作成や編集の画面でキャラクターに持たせられます。持ち替えると新しい版のシートになるので、銅の剣から鉄の剣のような成長も版の履歴に残ります。
      </p>
      {error && <p className="error">{error}</p>}

      {editing !== undefined && (
        <EquipmentEditor
          key={editing?.id ?? `new-${basedOn?.id ?? ""}`}
          settings={props.settings}
          item={editing}
          basedOn={basedOn}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void reload();
          }}
          onDerive={(e) => {
            setBasedOn(e);
            setEditing(null);
          }}
        />
      )}

      {list === null ? null : list.length === 0 ? (
        editing === undefined && (
          <div className="empty">
            <div>まだ装備品を登録していません。「新しく登録」で説明から画像を作るか、キャラクターの詳細画面の「装備品を登録」で、シートから登録できます。</div>
          </div>
        )
      ) : (
        <div className="grid">
          {list.map((e) => (
            <button key={e.id} className="tile outfit-tile" disabled={editing !== undefined} onClick={() => setEditing(e)}>
              <EquipmentThumb e={e} />
              <div className="meta">
                <div className="name">{e.name}</div>
                <div className="sub">
                  {EQUIPMENT_CATEGORY_LABEL[e.category]} · {e.description.ja}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 1つの装備品を直す(item が null なら新しく登録する) */
function EquipmentEditor(props: {
  settings: Settings;
  item: Equipment | null;
  /** 新しく登録するとき、最初から似せる装備品 */
  basedOn?: Equipment;
  onClose: () => void;
  onSaved: () => void;
  /** この装備品を元に、新しい装備品を作る */
  onDerive: (e: Equipment) => void;
}) {
  const o = props.item;
  const [name, setName] = useState(o?.name ?? "");
  const [category, setCategory] = useState<EquipmentCategory>(o?.category ?? props.basedOn?.category ?? "weapon");
  const [appearance, setAppearance] = useState<Appearance>(() => ({ ...emptyAppearance(), equipment: o?.description ?? { ja: "", en: "" } }));
  const [from, setFrom] = useState<EnSource>(() => sourceOf(appearance));
  /** 入れ替えた画像(null は外した、undefined は変えていない) */
  const [image, setImage] = useState<{ bytes: Uint8Array; ext: string; url: string } | null | undefined>();
  const [busy, setBusy] = useState<"translate" | "generate" | "save" | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  /** 説明から画像を作るときの画風と、似せる装備品 */
  const [style, setStyle] = useState(STYLE_PRESETS[0].en);
  const [similar, setSimilar] = useState<Equipment | undefined>(props.basedOn?.image ? props.basedOn : undefined);
  const job = useImageJob(props.settings);
  const input = useRef<HTMLInputElement>(null);
  const savedUrl = useFileUrl(o?.id ?? "", o?.image, "equipment");
  const shownUrl = image === undefined ? savedUrl : image?.url;

  useEffect(
    () => () => {
      if (image?.url) URL.revokeObjectURL(image.url);
    },
    [image],
  );

  const desc = appearance.equipment;
  const dirty =
    image !== undefined || name !== (o?.name ?? "") || category !== (o?.category ?? category) || desc.ja !== (o?.description.ja ?? "") || desc.en !== (o?.description.en ?? "");
  useLeaveGuard(busy === "generate" ? "画像を作っています。画面を離れると中断します。" : dirty && busy !== "save" ? "保存していない装備品の変更があります。画面を離れると変更は消えます。" : null);

  const pngImage = (bytes: Uint8Array, ext: string, type = "image/png") => ({ bytes, ext, url: URL.createObjectURL(new Blob([bytes as BlobPart], { type })) });

  const pickFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      const r = await readReference(f);
      setImage(pngImage(r.bytes, r.ext, f.type || "image/png"));
    } catch (e) {
      setError(message(e));
    }
  };

  /** 日本語を直した説明を英語にする */
  const translate = async (): Promise<Appearance | null> => {
    const keys = staleKeys(appearance, from).filter((k) => k === "equipment");
    if (!keys.length) return appearance;
    setBusy("translate");
    setError("");
    try {
      const en = await translateFields(props.settings, appearance, keys);
      const next = { ...appearance, equipment: { ...appearance.equipment, en: en.equipment ?? appearance.equipment.en } };
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

  /** 説明から、誰も持っていない装備品だけの画像を作る */
  const generate = async () => {
    setError("");
    setNote("");
    const a = await translate();
    if (!a) return;
    if (!a.equipment.en.trim()) {
      setError("装備品の説明を書いてください。");
      return;
    }
    setBusy("generate");
    try {
      let ref: Uint8Array | null = null;
      if (similar?.image) {
        try {
          ref = await loadFile(similar.id, similar.image, "equipment");
        } catch (e) {
          setNote(`「${similar.name}」の画像を読めなかったので、説明だけで作ります:${message(e)}`);
        }
      }
      const [width, height] = EQUIPMENT_IMAGE_SIZE;
      const seed = randomSeed();
      const r = await job.run((models) => {
        const def = engineOf(models.engine);
        const useRef = !!ref && def.canReference(models);
        if (ref && !useRef) setNote(`${def.label} では画像を参照できないので、「${similar?.name}」に似せずに説明だけで作ります。`);
        return {
          prompt: equipmentImagePrompt(a.equipment.en, style, def, useRef),
          negative: def.negative ? equipmentImageNegative() : undefined,
          width,
          height,
          seed,
          references: useRef ? [{ name: `equipment-${similar!.id}.${similar!.image!.split(".").pop()}`, bytes: ref! }] : [],
        };
      });
      if (r) setImage(pngImage(r.png, "png"));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setError("");
    const a = await translate();
    if (!a) return;
    if (!a.equipment.en.trim()) {
      setError("装備品の説明を書いてください。");
      return;
    }
    setBusy("save");
    try {
      if (!o) {
        await createEquipment({ name, category, description: a.equipment, image: image ?? undefined });
      } else {
        let next: Equipment = { ...o, name: name.trim() || o.name, category, description: a.equipment, updatedAt: new Date().toISOString() };
        // 前の画像のファイルは残す(ほかで使っていないかを確かめずに消さない)
        if (image !== undefined) next = await setEquipmentImage(next, image);
        await saveEquipment(next);
      }
      props.onSaved();
    } catch (e) {
      setError(`保存できませんでした:${message(e)}`);
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!o) return;
    const ok = await ask(`装備品「${o.name}」を削除しますか?\n保存先の .trash フォルダーに移します(そこから戻せます)。持たせたキャラクターは変わりません。`, { title: "削除", kind: "warning" });
    if (!ok) return;
    try {
      await deleteEquipment(o.id);
      props.onSaved();
    } catch (e) {
      setError(`削除できませんでした:${message(e)}`);
    }
  };

  return (
    <section className="card">
      <h3>{o ? `「${o.name}」を直す` : props.basedOn ? `「${props.basedOn.name}」を元に新しく登録` : "装備品を新しく登録"}</h3>
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
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void pickFile(e.target.files).then(() => (e.target.value = ""))} />
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
              <span className="small-text">似せる装備品:{similar ? <strong>{similar.name}</strong> : <span className="muted">なし</span>}</span>
              {similar && (
                <button className="small ghost" disabled={!!busy} onClick={() => setSimilar(undefined)}>
                  外す
                </button>
              )}
            </div>
            <EquipmentPicker label={similar ? "ほかの装備品に似せる" : "前の装備品に似せる"} disabled={!!busy} exclude={o ? [o.id] : []} onlyWithImage onPick={setSimilar} />
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
          <p className="muted small-text">
            誰も持っていない装備品だけの絵が、キャラクターに持たせやすい見本になります。「前の装備品に似せる」を選ぶと、その画像の形を引き継いで描きます(画像を参照できるモデルのとき)。
          </p>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label className="field">
            <span>名前</span>
            <input disabled={!!busy} placeholder="例)鉄の剣" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>種類</span>
            <select disabled={!!busy} value={category} onChange={(e) => setCategory(e.target.value as EquipmentCategory)}>
              {EQUIPMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EQUIPMENT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <AppearanceEditor
            keys={KEYS}
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
          {note && <p className="muted small-text">{note}</p>}
        </div>
      </div>
      <div className="row" style={{ marginBottom: 0 }}>
        <button className="primary" disabled={!!busy} onClick={() => void save()}>
          {busy === "save" ? "保存しています…" : busy === "translate" ? "英語に訳しています…" : busy === "generate" ? "画像を作っています…" : o ? "保存" : "登録する"}
        </button>
        <button disabled={busy === "save" || busy === "generate"} onClick={() => void confirmLeave().then((ok) => ok && props.onClose())}>
          やめる
        </button>
        <div style={{ flex: 1 }} />
        {o && (
          <>
            <button disabled={!!busy || dirty} title={dirty ? "保存してから使えます" : undefined} onClick={() => props.onDerive(o)}>
              これを元に新しく登録
            </button>
            <button disabled={!!busy} onClick={() => void remove()}>
              削除
            </button>
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
