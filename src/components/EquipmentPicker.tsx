import { useEffect, useState } from "react";
import type { Equipment } from "../types";
import { EQUIPMENT_CATEGORY_LABEL } from "../types";
import { listEquipment } from "../lib/storage";
import { useFileUrl } from "../lib/useFileUrl";

/** 装備品の見本の画像 */
export function EquipmentThumb({ e }: { e: Equipment }) {
  const url = useFileUrl(e.id, e.image, "equipment");
  return <div className="thumb">{url ? <img src={url} alt="" /> : <span>画像なし</span>}</div>;
}

/** 登録した装備品から1つ選ぶ。開いたときに一覧を読む。exclude の装備品は出さない */
export function EquipmentPicker(props: { label: string; onPick: (e: Equipment) => void; disabled?: boolean; exclude?: string[]; onlyWithImage?: boolean }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Equipment[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    listEquipment()
      .then(setList)
      .catch((e) => {
        setList([]);
        setError(`装備品を読めませんでした:${String(e)}`);
      });
  }, [open]);

  const shown = list?.filter((e) => !props.exclude?.includes(e.id) && (!props.onlyWithImage || e.image));

  return (
    <div>
      <button className="small" disabled={props.disabled} onClick={() => setOpen(!open)}>
        {open ? "閉じる" : props.label}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {error && <p className="error">{error}</p>}
          {shown?.length === 0 && !error && (
            <p className="muted small-text">
              {props.onlyWithImage ? "画像のある装備品がありません。" : "まだ装備品を登録していません。左の「装備品」の画面か、キャラクターの詳細画面の「装備品を登録」で登録できます。"}
            </p>
          )}
          {!!shown?.length && (
            <div className="grid small-grid">
              {shown.map((e) => (
                <button
                  key={e.id}
                  className="tile"
                  disabled={props.disabled}
                  title={e.description.ja}
                  onClick={() => {
                    setOpen(false);
                    props.onPick(e);
                  }}
                >
                  <EquipmentThumb e={e} />
                  <div className="meta">
                    <div className="name">{e.name}</div>
                    <div className="sub">{EQUIPMENT_CATEGORY_LABEL[e.category]}</div>
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
