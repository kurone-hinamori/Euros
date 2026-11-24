import { useEffect, useState } from "react";
import type { CharacterSummary, Settings } from "../types";
import { listCharacters } from "../lib/storage";
import { useFileUrl } from "../lib/useFileUrl";
import { importFlow } from "../lib/transfer";

function Thumb({ id, file }: { id: string; file: string | null }) {
  const url = useFileUrl(id, file);
  return <div className="thumb">{url ? <img src={url} alt="" /> : <span>シートなし</span>}</div>;
}

type Sort = "updated" | "created" | "name";
const SORT_KEY = "euros.listSort";
const nameKey = (c: CharacterSummary) => c.reading || c.name || "";
const SORTS: Record<Sort, { label: string; compare: (a: CharacterSummary, b: CharacterSummary) => number }> = {
  updated: { label: "更新が新しい順", compare: (a, b) => b.updatedAt.localeCompare(a.updatedAt) },
  created: { label: "作成が新しい順", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
  name: { label: "名前順", compare: (a, b) => nameKey(a).localeCompare(nameKey(b), "ja") },
};

const dateOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ja-JP");
};

export function CharacterList(props: { settings: Settings; onOpen: (id: string) => void; onNew: () => void }) {
  const [list, setList] = useState<CharacterSummary[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(() => {
    try {
      return (localStorage.getItem(SORT_KEY) as Sort) || "updated";
    } catch {
      return "updated";
    }
  });
  const changeSort = (s: Sort) => {
    setSort(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {
      /* 覚えられなくても並べ替えはできる */
    }
  };

  useEffect(() => {
    listCharacters()
      .then(setList)
      .catch((e) => {
        setList([]);
        setError(`ライブラリを読めませんでした:${String(e)}`);
      });
    // 保存先を変えたら読み直す
  }, [props.settings.libraryDir]);

  const [importing, setImporting] = useState(false);
  const importFile = async () => {
    setImporting(true);
    setError("");
    try {
      const id = await importFlow();
      if (id) props.onOpen(id);
    } catch (e) {
      setError(`読み込めませんでした:${String(e)}`);
    } finally {
      setImporting(false);
    }
  };

  const q = query.trim();
  const shown = (list ?? []).filter((c) => !q || `${c.name ?? ""} ${c.reading ?? ""}`.includes(q)).sort(SORTS[sort].compare);

  return (
    <div className="page">
      <header className="page-head">
        <h2>キャラクター</h2>
        <div className="grow" />
        <select style={{ width: 130 }} value={sort} onChange={(e) => changeSort(e.target.value as Sort)}>
          {(Object.keys(SORTS) as Sort[]).map((k) => (
            <option key={k} value={k}>
              {SORTS[k].label}
            </option>
          ))}
        </select>
        <input style={{ width: 220 }} placeholder="名前で探す" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button disabled={importing} onClick={() => void importFile()} title="書き出した .euros ファイルを読み込みます">
          読み込む
        </button>
        <button className="primary" onClick={props.onNew}>
          新規作成
        </button>
      </header>
      {error && <p className="error">{error}</p>}
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
