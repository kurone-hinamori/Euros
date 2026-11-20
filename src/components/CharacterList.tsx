import { useEffect, useState } from "react";
import type { CharacterSummary, Settings } from "../types";
import { fileUrl, listCharacters } from "../lib/storage";

function Thumb({ id, file }: { id: string; file: string | null }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file) return;
    let made: string | undefined;
    let alive = true;
    fileUrl(id, file)
      .then((u) => {
        made = u;
        if (alive) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id, file]);
  return <div className="thumb">{url ? <img src={url} alt="" /> : <span>シートなし</span>}</div>;
}

const dateOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ja-JP");
};

export function CharacterList(props: { settings: Settings; onOpen: (id: string) => void; onNew: () => void }) {
  const [list, setList] = useState<CharacterSummary[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    listCharacters()
      .then(setList)
      .catch((e) => {
        setList([]);
        setError(String(e));
      });
    // 保存先を変えたら読み直す
  }, [props.settings.libraryDir]);

  const q = query.trim();
  const shown = (list ?? []).filter((c) => !q || `${c.name ?? ""} ${c.reading ?? ""}`.includes(q));

  return (
    <div className="page">
      <header className="page-head">
        <h2>キャラクター</h2>
        <div className="grow" />
        <input style={{ width: 220 }} placeholder="名前で探す" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="primary" onClick={props.onNew}>
          新規作成
        </button>
      </header>
      {error && <p className="error">ライブラリを読めませんでした:{error}</p>}
      {list === null ? null : list.length === 0 ? (
        <div className="empty">
          <div>まだキャラクターがいません。</div>
          <button className="primary" onClick={props.onNew}>
            最初のキャラクターを作る
          </button>
        </div>
      ) : (
        <div className="grid">
          {shown.map((c) => (
            <button key={c.id} className="tile" onClick={() => props.onOpen(c.id)}>
              <Thumb id={c.id} file={c.sheet} />
              <div className="meta">
                <div className="name">{c.name || "(名前なし)"}</div>
                <div className="sub">
                  {c.reading && `${c.reading} · `}
                  {dateOf(c.updatedAt)} · 版 {c.revisionCount}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
