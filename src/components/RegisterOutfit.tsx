import { useEffect, useState } from "react";
import type { Box1000, Character, Revision } from "../types";
import { createOutfit, cropImage, outfitNameOf } from "../lib/outfits";
import { SHEET_REGIONS } from "../lib/sheet";
import { loadFile } from "../lib/storage";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const region = (label: string) => SHEET_REGIONS.find((r) => r.label === label)!.box;

/** 見本の画像にする、シートの区画 */
const CROPS: { key: string; label: string; box?: Box1000 }[] = [
  { key: "detail", label: "衣装・小物の区画(人が着ていない絵)", box: region("衣装・小物") },
  { key: "front", label: "正面の立ち姿", box: region("正面") },
  { key: "none", label: "画像なし(説明だけ)" },
];

/** キャラクターのシートから、衣装を登録する */
export function RegisterOutfit(props: { ch: Character; rev: Revision; onDone: (name: string) => void; onClose: () => void }) {
  const { ch, rev } = props;
  const [name, setName] = useState(outfitNameOf(ch));
  const [crop, setCrop] = useState(CROPS[0].key);
  const [png, setPng] = useState<Uint8Array | null>(null);
  const [url, setUrl] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const box = CROPS.find((c) => c.key === crop)?.box;
  const a = rev.appearance;

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
    setSaving(true);
    setError("");
    try {
      const o = await createOutfit({
        name,
        outfit: a.outfit,
        accessories: a.accessories,
        image: png ? { bytes: png, ext: "png" } : undefined,
        source: { characterId: ch.id, revisionId: rev.id },
      });
      props.onDone(o.name);
    } catch (e) {
      setError(`登録できませんでした:${message(e)}`);
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <h3>衣装を登録</h3>
      <p className="muted small-text" style={{ marginTop: 0 }}>
        この版の衣装と小物の説明と、シートの一部を見本の画像にして登録します。ほかのキャラクターを作るときや編集するときに着せられます。
      </p>
      <div className="outfit-edit">
        <div className="outfit-image">{url ? <img src={url} alt="見本" /> : <div className="noimage">{box ? "切り出しています…" : "画像なし"}</div>}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label className="field">
            <span>名前</span>
            <input disabled={saving} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="field">
            <span>見本の画像</span>
            {CROPS.map((c) => (
              <label key={c.key} className="check">
                <input type="radio" name="crop" disabled={saving} checked={crop === c.key} onChange={() => setCrop(c.key)} />
                {c.label}
              </label>
            ))}
          </div>
          <table className="kv">
            <tbody>
              <tr>
                <th>衣装</th>
                <td>{a.outfit.ja || <span className="muted">(なし)</span>}</td>
              </tr>
              <tr>
                <th>小物</th>
                <td>{a.accessories.ja || <span className="muted">(なし)</span>}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small-text">説明は、登録したあと左の「衣装」の画面で直せます。</p>
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
