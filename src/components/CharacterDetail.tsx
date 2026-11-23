import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { Character, Revision, Settings } from "../types";
import { APPEARANCE_KEYS, APPEARANCE_LABEL } from "../types";
import { engineOf } from "../lib/comfy";
import { deleteCharacter, loadCharacter, saveCharacter } from "../lib/storage";
import { useFileUrl } from "../lib/useFileUrl";
import { exportFlow } from "../lib/transfer";
import { USE_LABEL } from "./ReferencePicker";
import { RegisterOutfit } from "./RegisterOutfit";
import { RegisterEquipment } from "./RegisterEquipment";
import { SheetViewer } from "./SheetViewer";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const dateTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
};

export const KIND_LABEL: Record<Revision["kind"], string> = {
  create: "新規作成",
  instruction: "修正指示",
  redraw: "描き直し",
  manual: "外見を直接編集",
};

const METHOD_LABEL: Record<Revision["method"], string> = {
  fresh: "新しく描く",
  same_seed: "同じ seed で描き直す",
  reference: "元のシートを参照して描く",
  redraw: "範囲だけ描き直す",
};

type Tab = "appearance" | "profile" | "prompt" | "history" | "references";

const TABS: { key: Tab; label: string }[] = [
  { key: "appearance", label: "外見" },
  { key: "profile", label: "プロフィール" },
  { key: "prompt", label: "プロンプト" },
  { key: "history", label: "履歴" },
  { key: "references", label: "参照画像" },
];

/** 2つの版で、日本語の説明が違う外見の項目 */
const changedKeys = (a: Revision, b: Revision) => APPEARANCE_KEYS.filter((k) => a.appearance[k].ja !== b.appearance[k].ja || a.appearance[k].en !== b.appearance[k].en);

function RevisionImage({ id, rev, onClick, className }: { id: string; rev: Revision; onClick?: () => void; className?: string }) {
  const url = useFileUrl(id, rev.image);
  return url ? <img className={className} src={url} alt="" onClick={onClick} /> : <div className={`${className ?? ""} noimage`}>画像なし</div>;
}

function RefImage({ id, file }: { id: string; file: string }) {
  const url = useFileUrl(id, file);
  return url ? <img src={url} alt="" /> : <div className="noimage" />;
}

export function CharacterDetail(props: { id: string; settings: Settings; onBack: () => void; onEdit: (id: string) => void }) {
  const [ch, setCh] = useState<Character | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("appearance");
  /** 見ている版(未指定は採用中の版) */
  const [viewing, setViewing] = useState<string>();
  /** 比べる版 */
  const [compare, setCompare] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  /** シートから登録している物 */
  const [registering, setRegistering] = useState<"outfit" | "equipment" | null>(null);

  useEffect(() => {
    setCh(null);
    loadCharacter(props.id)
      .then(setCh)
      .catch((e) => setError(`読み込めませんでした:${message(e)}`));
  }, [props.id]);

  const revs = ch?.revisions ?? [];
  const currentRev = revs.find((r) => r.id === ch?.currentRevision) ?? revs[revs.length - 1];
  const shown = revs.find((r) => r.id === viewing) ?? currentRev;
  const compared = revs.find((r) => r.id === compare);
  /** 比べるときは、古い版を左に置く */
  const pair = compared && shown ? [compared, shown].sort((a, b) => revs.indexOf(a) - revs.indexOf(b)) : [];
  const sheetUrl = useFileUrl(props.id, shown?.image);
  const numberOf = (r: Revision) => revs.indexOf(r) + 1;

  if (error) {
    return (
      <div className="page">
        <button className="ghost" onClick={props.onBack}>
          ← 一覧
        </button>
        <p className="error">{error}</p>
      </div>
    );
  }
  if (!ch) return null;

  const update = async (next: Character) => {
    const saved = { ...next, updatedAt: new Date().toISOString() };
    setCh(saved);
    try {
      await saveCharacter(saved);
    } catch (e) {
      setError(`保存できませんでした:${message(e)}`);
    }
  };

  /** 版を採用する。外見もその版のものに戻す */
  const adopt = (r: Revision) => {
    void update({ ...ch, currentRevision: r.id, appearance: structuredClone(r.appearance) });
    setViewing(undefined);
    setCompare(undefined);
  };

  const remove = async () => {
    const ok = await ask(`「${ch.profile.name || "名前なし"}」を削除しますか?\n保存先の .trash フォルダーに移します(そこから戻せます)。`, { title: "削除", kind: "warning" });
    if (!ok) return;
    try {
      await deleteCharacter(ch.id);
      props.onBack();
    } catch (e) {
      setError(`削除できませんでした:${message(e)}`);
    }
  };

  const exportFile = async () => {
    setError("");
    try {
      const path = await exportFlow(ch);
      if (path) setNote(`書き出しました:${path}`);
    } catch (e) {
      setError(`書き出せませんでした:${message(e)}`);
    }
  };

  const copyWorkflow = async () => {
    if (!shown?.workflow) return;
    await navigator.clipboard.writeText(JSON.stringify(shown.workflow, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const p = ch.profile;
  const isCurrent = shown?.id === currentRev?.id;

  return (
    <div className="page">
      <header className="page-head">
        <button className="ghost" onClick={props.onBack}>
          ← 一覧
        </button>
        <h2>
          {p.name || "(名前なし)"}
          {p.reading && <span className="reading">{p.reading}</span>}
        </h2>
        <div className="grow" />
        <button className="primary" onClick={() => props.onEdit(ch.id)}>
          編集
        </button>
        <button disabled={!shown?.image} onClick={() => setRegistering("outfit")} title="表示している版の衣装を、ほかのキャラクターに着せられるよう登録します">
          衣装を登録
        </button>
        <button disabled={!shown?.image} onClick={() => setRegistering("equipment")} title="表示している版の武器などを、ほかのキャラクターに持たせられるよう登録します">
          装備品を登録
        </button>
        <button onClick={() => void exportFile()} title="ほかのパソコンやアプリに渡せる .euros ファイルにします">
          書き出す
        </button>
        <button onClick={() => void remove()}>削除</button>
      </header>
      {note && <p className="muted small-text">{note}</p>}
      {registering === "outfit" && shown && (
        <RegisterOutfit
          key={shown.id}
          ch={ch}
          rev={shown}
          onClose={() => setRegistering(null)}
          onDone={(name) => {
            setRegistering(null);
            setNote(`衣装「${name}」を登録しました。左の「衣装」の画面で見られます。`);
          }}
        />
      )}
      {registering === "equipment" && shown && (
        <RegisterEquipment
          key={shown.id}
          settings={props.settings}
          ch={ch}
          rev={shown}
          onClose={() => setRegistering(null)}
          onDone={(name) => {
            setRegistering(null);
            setNote(`装備品「${name}」を登録しました。左の「装備品」の画面で見られます。`);
          }}
        />
      )}

      {shown && !isCurrent && (
        <div className="notice">
          <span>
            版 {numberOf(shown)}({KIND_LABEL[shown.kind]})を表示しています。採用中は版 {currentRev && numberOf(currentRev)} です。
          </span>
          <button className="small" onClick={() => adopt(shown)}>
            この版を採用
          </button>
          <button className="small" onClick={() => setViewing(undefined)}>
            採用中の版に戻る
          </button>
        </div>
      )}

      {pair.length === 2 ? (
        <div className="compare">
          <div className="compare-head">
            <span>
              版 {numberOf(pair[0])} と 版 {numberOf(pair[1])} の比較
            </span>
            <button className="small" onClick={() => setCompare(undefined)}>
              比較をやめる
            </button>
          </div>
          <div className="compare-grid">
            {pair.map((r) => (
              <figure key={r.id}>
                <RevisionImage id={ch.id} rev={r} className="compare-img" />
                <figcaption>
                  版 {numberOf(r)} · {KIND_LABEL[r.kind]} · {dateTime(r.createdAt)}
                </figcaption>
              </figure>
            ))}
          </div>
          <table className="diff">
            <tbody>
              {changedKeys(pair[0], pair[1]).map((k) => (
                <tr key={k}>
                  <th>{APPEARANCE_LABEL[k]}</th>
                  <td>{pair[0].appearance[k].ja}</td>
                  <td>→</td>
                  <td>{pair[1].appearance[k].ja}</td>
                </tr>
              ))}
              {!changedKeys(pair[0], pair[1]).length && (
                <tr>
                  <td className="muted">外見の説明は同じです</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <SheetViewer src={sheetUrl} />
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === "history" && ` (${revs.length})`}
            {t.key === "references" && ` (${ch.references.length})`}
          </button>
        ))}
      </nav>

      <section className="card tab-body">
        {tab === "appearance" && (
          <table className="kv">
            <tbody>
              {APPEARANCE_KEYS.filter((k) => ch.appearance[k].ja || ch.appearance[k].en).map((k) => (
                <tr key={k}>
                  <th>{APPEARANCE_LABEL[k]}</th>
                  <td>
                    <div>{ch.appearance[k].ja}</div>
                    <div className="en-text">{ch.appearance[k].en}</div>
                  </td>
                </tr>
              ))}
              <tr>
                <th>画風</th>
                <td className="en-text">{ch.style}</td>
              </tr>
              <tr>
                <th>表情</th>
                <td>{ch.sheet.expressions.map((e) => e.ja).join("、")}</td>
              </tr>
            </tbody>
          </table>
        )}

        {tab === "profile" && (
          <table className="kv">
            <tbody>
              {(
                [
                  ["読み", p.reading],
                  ["年齢", p.age],
                  ["性別", p.gender],
                  ["立場・職業", p.role],
                  ["性格", p.personality],
                  ["口調", p.speech],
                  ["経歴", p.background],
                  ["メモ", p.notes],
                  ["最初の説明", ch.sourceJa],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <tr key={k}>
                    <th>{k}</th>
                    <td className="pre">{v}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}

        {tab === "prompt" && shown && (
          <div>
            <table className="kv">
              <tbody>
                <tr>
                  <th>版</th>
                  <td>
                    版 {numberOf(shown)} · {KIND_LABEL[shown.kind]} · {dateTime(shown.createdAt)}
                  </td>
                </tr>
                <tr>
                  <th>モデル</th>
                  <td>
                    {engineOf(shown.engine).label}
                    <div className="en-text">{[shown.modelFiles.unet, shown.modelFiles.clip, shown.modelFiles.vae, shown.modelFiles.lora].filter(Boolean).join(" / ")}</div>
                  </td>
                </tr>
                <tr>
                  <th>描き方</th>
                  <td>
                    {METHOD_LABEL[shown.method]} · seed {shown.seed} · {shown.width}×{shown.height}
                    {shown.references.length > 0 && ` · 参照 ${shown.references.length} 枚`}
                  </td>
                </tr>
              </tbody>
            </table>
            <h3 style={{ marginTop: 12 }}>プロンプト</h3>
            <pre className="mono box">{shown.prompt}</pre>
            {shown.negative && (
              <>
                <h3 style={{ marginTop: 12 }}>否定のプロンプト</h3>
                <pre className="mono box">{shown.negative}</pre>
              </>
            )}
            {!!shown.workflow && (
              <div className="row" style={{ marginTop: 12, marginBottom: 0 }}>
                <button className="small" onClick={() => void copyWorkflow()}>
                  ComfyUI のワークフローをコピー
                </button>
                {copied && <span className="muted">コピーしました</span>}
              </div>
            )}
          </div>
        )}

        {tab === "history" && (
          <div className="history">
            {[...revs].reverse().map((r) => {
              const parent = revs.find((x) => x.id === r.parentId);
              const changes = parent ? changedKeys(parent, r) : [];
              return (
                <div key={r.id} className={`rev${r.id === shown?.id ? " viewing" : ""}`}>
                  <RevisionImage id={ch.id} rev={r} className="rev-img" onClick={() => setViewing(r.id)} />
                  <div className="rev-body">
                    <div className="rev-title">
                      版 {numberOf(r)} · {KIND_LABEL[r.kind]}
                      {r.id === currentRev?.id && <span className="tag">採用中</span>}
                    </div>
                    <div className="muted small-text">
                      {dateTime(r.createdAt)} · {engineOf(r.engine).label} · {METHOD_LABEL[r.method]}
                      {parent && ` · 版 ${numberOf(parent)} から`}
                    </div>
                    {r.instructionJa && <div className="instruction">「{r.instructionJa}」</div>}
                    {changes.length > 0 && <div className="muted small-text">変わった項目:{changes.map((k) => APPEARANCE_LABEL[k]).join("、")}</div>}
                    <div className="row" style={{ margin: "6px 0 0" }}>
                      <button className="small" onClick={() => setViewing(r.id)}>
                        表示
                      </button>
                      {r.id !== currentRev?.id && (
                        <>
                          <button className="small" onClick={() => adopt(r)}>
                            採用
                          </button>
                          <button
                            className="small"
                            onClick={() => {
                              setViewing(currentRev?.id);
                              setCompare(r.id);
                            }}
                          >
                            採用中と比べる
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "references" &&
          (ch.references.length ? (
            <div className="refs">
              {ch.references.map((r) => (
                <div key={r.id} className="ref">
                  <RefImage id={ch.id} file={r.file} />
                  <div className="ref-meta">
                    <div className="ref-name" title={r.label}>
                      {r.label}
                    </div>
                    <div className="muted small-text">{USE_LABEL[r.use]}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              参照画像はありません。
            </p>
          ))}
      </section>
    </div>
  );
}
