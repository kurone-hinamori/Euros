import { useEffect, useState } from "react";
import type { Outfit } from "../types";
import { listOutfits } from "../lib/storage";
import { useFileUrl } from "../lib/useFileUrl";

/** 衣装の見本の画像 */
export function OutfitThumb({ o }: { o: Outfit }) {
  const url = useFileUrl(o.id, o.image, "outfits");
  return <div className="thumb">{url ? <img src={url} alt="" /> : <span>画像なし</span>}</div>;
}

/** 登録した衣装から1つ選ぶ。開いたときに一覧を読む */
export function OutfitPicker(props: { label: string; onPick: (o: Outfit) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Outfit[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    listOutfits()
      .then(setList)
      .catch((e) => {
        setList([]);
        setError(`衣装を読めませんでした:${String(e)}`);
      });
  }, [open]);

  return (
    <div>
      <button className="small" disabled={props.disabled} onClick={() => setOpen(!open)}>
        {open ? "閉じる" : props.label}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {error && <p className="error">{error}</p>}
          {list?.length === 0 && !error && <p className="muted small-text">まだ衣装を登録していません。キャラクターの詳細画面の「衣装を登録」か、左の「衣装」の画面で登録できます。</p>}
          {!!list?.length && (
            <div className="grid small-grid">
              {list.map((o) => (
                <button
                  key={o.id}
                  className="tile"
                  disabled={props.disabled}
                  title={[o.outfit.ja, o.accessories.ja].filter(Boolean).join("\n")}
                  onClick={() => {
                    setOpen(false);
                    props.onPick(o);
                  }}
                >
                  <OutfitThumb o={o} />
                  <div className="meta">
                    <div className="name">{o.name}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
