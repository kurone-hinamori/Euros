import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import type { Settings } from "../types";
import { comfyStats } from "../lib/comfy";
import { ImageModelSettings } from "./ImageModelSettings";
import { ComfyTest } from "./ComfyTest";
import { SamplingSettings } from "./SamplingSettings";
import { listModels } from "../lib/ollama";
import { libraryInfo, openLibrary, saveSettings } from "../lib/storage";
import { installUpdate } from "../lib/updater";

type Status = { ok: boolean; text: string } | null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

export function SettingsView({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [comfy, setComfy] = useState<Status>(null);
  const [ollama, setOllama] = useState<Status>(null);
  const [models, setModels] = useState<string[]>([]);
  const [library, setLibrary] = useState<{ path: string; defaultPath: string }>();
  const [version, setVersion] = useState("");
  const [updateMsg, setUpdateMsg] = useState("");
  const [updating, setUpdating] = useState(false);

  const checkComfy = async () => {
    setComfy({ ok: true, text: "確認中…" });
    try {
      const st = await comfyStats(settings);
      const gpu = st.devices[0];
      setComfy({ ok: true, text: `接続できました(ComfyUI ${st.version}${gpu ? ` · ${gpu.name.replace(/^cuda:\d+\s*/, "")}` : ""})` });
    } catch (e) {
      setComfy({ ok: false, text: `接続できません。ComfyUI が起動しているか確認してください。(${message(e)})` });
    }
  };

  const checkOllama = async () => {
    setOllama({ ok: true, text: "確認中…" });
    try {
      const list = await listModels(settings);
      setModels(list);
      setOllama({ ok: true, text: `接続できました(モデル ${list.length} 件)` });
      if (!settings.model && list.length) onChange({ ...settings, model: list[0] });
    } catch (e) {
      setModels([]);
      setOllama({ ok: false, text: `接続できません。Ollama が起動しているか確認してください。(${message(e)})` });
    }
  };

  const refreshLibrary = () => libraryInfo().then(setLibrary).catch(() => undefined);

  useEffect(() => {
    void checkComfy();
    void checkOllama();
    void refreshLibrary();
    getVersion().then(setVersion).catch(() => undefined);
    // 開いたときに一度だけ確認する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 保存先は Rust が settings.json から読むので、先に保存してから切り替える */
  const changeLibrary = async (dir: string) => {
    const next = { ...settings, libraryDir: dir };
    await saveSettings(next);
    onChange(next);
    await refreshLibrary();
  };

  const chooseLibrary = async () => {
    const dir = await open({ directory: true, title: "キャラクターの保存先を選ぶ" });
    if (typeof dir === "string") await changeLibrary(dir);
  };

  const checkUpdate = async () => {
    setUpdating(true);
    setUpdateMsg("確認中…");
    try {
      const u = await check();
      if (!u) {
        setUpdateMsg("最新版です");
        return;
      }
      setUpdateMsg(`新しいバージョン ${u.version} をダウンロード中… 0%`);
      await installUpdate(u, (p) => setUpdateMsg(`新しいバージョン ${u.version} をダウンロード中… ${p}%`));
      setUpdateMsg("更新しました。再起動します…");
    } catch (e) {
      setUpdateMsg(`更新できませんでした:${message(e)}`);
    } finally {
      setUpdating(false);
    }
  };

  const statusLine = (s: Status) => s && <span className={s.ok ? "muted" : "error"}>{s.text}</span>;

  return (
    <div className="page narrow">
      <header className="page-head">
        <h2>設定</h2>
      </header>

      <section className="card">
        <h3>画像生成(ComfyUI)</h3>
        <Field label="ComfyUI の URL" value={settings.comfyUrl} onChange={(v) => onChange({ ...settings, comfyUrl: v })} />
        <div className="row">
          <button onClick={() => void checkComfy()}>接続確認</button>
          {statusLine(comfy)}
        </div>
        <ImageModelSettings settings={settings} onChange={onChange} />
      </section>

      <section className="card">
        <SamplingSettings settings={settings} onChange={onChange} />
      </section>

      <section className="card">
        <h3>生成の確認</h3>
        <ComfyTest settings={settings} />
      </section>

      <section className="card">
        <h3>プロンプトの作成(Ollama)</h3>
        <Field label="Ollama の URL" value={settings.ollamaUrl} onChange={(v) => onChange({ ...settings, ollamaUrl: v })} />
        <div className="row">
          <button onClick={() => void checkOllama()}>接続確認・モデル一覧を更新</button>
          {statusLine(ollama)}
        </div>
        <label className="field">
          <span>使用するモデル</span>
          <select value={settings.model} onChange={(e) => onChange({ ...settings, model: e.target.value })}>
            {!models.includes(settings.model) && <option value={settings.model}>{settings.model || "(未選択)"}</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>temperature(低いほど説明に忠実):{settings.temperature.toFixed(2)}</span>
          <input type="range" min={0} max={1.2} step={0.05} value={settings.temperature} onChange={(e) => onChange({ ...settings, temperature: Number(e.target.value) })} />
        </label>
      </section>

      <section className="card">
        <h3>保存先</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          作ったキャラクターはここに保存され、Notos などほかのアプリから読み込めます。
        </p>
        <div className="field">
          <span>いまの保存先{!settings.libraryDir && "(既定)"}</span>
          <div className="mono">{library?.path ?? "…"}</div>
        </div>
        <div className="row">
          <button onClick={() => void chooseLibrary()}>保存先を選ぶ</button>
          {settings.libraryDir && <button onClick={() => void changeLibrary("")}>既定に戻す</button>}
          <button onClick={() => void openLibrary()}>フォルダーを開く</button>
        </div>
      </section>

      <section className="card">
        <h3>バージョン</h3>
        <div className="row" style={{ marginBottom: 0 }}>
          <span>Euros {version && `v${version}`}</span>
          <button disabled={updating} onClick={() => void checkUpdate()}>
            更新を確認
          </button>
          {updateMsg && <span className="muted">{updateMsg}</span>}
        </div>
      </section>
    </div>
  );
}
