import { useEffect, useMemo, useState } from "react";
import type { Box1000, Character, EquipmentCategory, Revision, Settings } from "../types";
import { EQUIPMENT_CATEGORIES, EQUIPMENT_CATEGORY_LABEL } from "../types";
import { createEquipment, equipmentNameOf } from "../lib/equipment";
import { cropImage } from "../lib/outfits";
import { translateFields } from "../lib/prompts";
import { SHEET_REGIONS, detailParts } from "../lib/sheet";
import { loadFile } from "../lib/storage";
import { EquipmentShapeEditor, type EquipmentShape } from "./ShapeEditor";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** キャラクターのシートから、装備品を登録する */
export function RegisterEquipment(props: { settings: Settings; ch: Character; rev: Revision; onDone: (name: string) => void; onClose: () => void }) {
  const { ch, rev } = props;
  const a = rev.appearance;

  // 見本の画像にする区画。装備品の区画があればそれを、なければ(前の版では武器は小物に入っていた)小物の区画を先に出す
  const crops = useMemo(() => {
    const parts = detailParts(a, ch.sheet.notHuman);
    const box = (k: string) => parts.find((p) => p.key === k)?.box;
    const list: { key: string; label: string; box?: Box1000 }[] = [];
    const eq = box("equipment");
    if (eq) list.push({ key: "equipment", label: "装備品の区画", box: eq });
    const acc = box("accessories");
    if (acc) list.push({ key: "accessories", label: "小物の区画", box: acc });
    list.push({ key: "detail", label: "衣装・小物の区画の全体", box: SHEET_REGIONS.find((r) => r.label === "衣装・小物")!.box });
    list.push({ key: "none", label: "画像なし(説明だけ)" });
    return list;
  }, [a, ch.sheet.notHuman]);

  const first = a.equipment.ja.trim() ? a.equipment : a.accessories;
  const [name, setName] = useState(equipmentNameOf(ch.profile.name));
  const [category, setCategory] = useState<EquipmentCategory>("weapon");
  const [shape, setShape] = useState<EquipmentShape>({});
  const [ja, setJa] = useState(first.ja);
  const [crop, setCrop] = useState(crops[0].key);
  const [png, setPng] = useState<Uint8Array | null>(null);
  const [url, setUrl] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const box = crops.find((c) => c.key === crop)?.box;

  // 選んだ区画を切り出して見せる
  useEffect(() => {
    setPng(null);
    setUrl(undefined);
    if (!box || !rev.image) return;
    let alive = true;
    let made: string | undefined;
    loadFile(ch.id, rev.image)
      .then((bytes) => cropImage(bytes, box))
      .then((out) => {
        if (!alive) return;
        made = URL.createObjectURL(new Blob([out as BlobPart], { type: "image/png" }));
        setPng(out);
        setUrl(made);
      })
      .catch((e) => alive && setError(`シートを読めませんでした:${message(e)}`));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [ch.id, rev.image, box]);

  const save = async () => {
    if (!ja.trim()) {
      setError("装備品の説明を書いてください。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // 説明を直したら英語にする(直していなければ、シートの英語をそのまま使う)
      const en =
        ja === first.ja && first.en.trim()
          ? first.en
          : ((await translateFields(props.settings, { ...a, equipment: { ja, en: "" } }, ["equipment"])).equipment ?? "");
      const e = await createEquipment({
        name,
        category,
        description: { ja: ja.trim(), en },
        image: png ? { bytes: png, ext: "png" } : undefined,
        source: { characterId: ch.id, revisionId: rev.id },
        shape,
      });
      props.onDone(e.name);
    } catch (e) {
      setError(`登録できませんでした:${message(e)}`);
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <h3>装備品を登録</h3>
      <p className="muted small-text" style={{ marginTop: 0 }}>
        この版のシートの一部を見本の画像にして、装備品を登録します。ほかのキャラクターに持たせたり、「装備品」の画面で、これを元に次の装備品を作ったりできます。
      </p>
      <div className="outfit-edit">
        <div className="outfit-image">{url ? <img src={url} alt="見本" /> : <div className="noimage">{box ? "切り出しています…" : "画像なし"}</div>}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label className="field">
            <span>名前</span>
            <input disabled={saving} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>種類</span>
            <select disabled={saving} value={category} onChange={(e) => setCategory(e.target.value as EquipmentCategory)}>
              {EQUIPMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EQUIPMENT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>説明</span>
            <textarea rows={2} disabled={saving} placeholder="例)刃の広い鉄の片手剣。柄に革を巻いている。" value={ja} onChange={(e) => setJa(e.target.value)} />
          </label>
          <EquipmentShapeEditor shape={shape} disabled={saving} onChange={setShape} />
          <div className="field">
            <span>見本の画像</span>
            {crops.map((c) => (
              <label key={c.key} className="check">
                <input type="radio" name="equipment-crop" disabled={saving} checked={crop === c.key} onChange={() => setCrop(c.key)} />
                {c.label}
              </label>
            ))}
          </div>
          <p className="muted small-text">区画に装備品以外も入っているときは、登録したあと「装備品」の画面で画像を作り直せます。</p>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 0 }}>
        <button className="primary" disabled={saving || (!!box && !png)} onClick={() => void save()}>
          {saving ? "登録しています…" : "登録する"}
        </button>
        <button disabled={saving} onClick={props.onClose}>
          やめる
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
