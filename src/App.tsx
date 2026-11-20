import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Settings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { loadSettings, saveSettings } from "./lib/storage";
import { CharacterList } from "./components/CharacterList";
import { SettingsView } from "./components/SettingsView";
import { UpdateBanner } from "./components/UpdateBanner";
import { Placeholder } from "./components/Placeholder";

export type View = { kind: "list" } | { kind: "new" } | { kind: "detail"; id: string } | { kind: "settings" };

export default function App() {
  const [view, setView] = useState<View>({ kind: "list" });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setReady(true);
    });
    getVersion().then(setVersion).catch(() => undefined);
  }, []);

  const changeSettings = (s: Settings) => {
    setSettings(s);
    void saveSettings(s).catch(() => undefined);
  };

  const nav = (label: string, target: View, active: boolean) => (
    <button className={`nav${active ? " active" : ""}`} onClick={() => setView(target)}>
      {label}
    </button>
  );

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">EUROS</div>
        {nav("キャラクター", { kind: "list" }, view.kind === "list" || view.kind === "detail")}
        {nav("新規作成", { kind: "new" }, view.kind === "new")}
        <div className="spacer" />
        {nav("設定", { kind: "settings" }, view.kind === "settings")}
        {version && <div className="version">v{version}</div>}
      </aside>
      <main className="main">
        <UpdateBanner />
        <div className="content">
          {!ready ? null : view.kind === "list" ? (
            <CharacterList settings={settings} onOpen={(id) => setView({ kind: "detail", id })} onNew={() => setView({ kind: "new" })} />
          ) : view.kind === "new" ? (
            <Placeholder title="新規作成" text="日本語の説明と参照画像からキャラクターシートを作る画面です(手順3で作ります)。" />
          ) : view.kind === "detail" ? (
            <Placeholder title="詳細" text="シート、プロフィール、プロンプト、変更の履歴を見る画面です(手順4で作ります)。" onBack={() => setView({ kind: "list" })} />
          ) : (
            <SettingsView settings={settings} onChange={changeSettings} />
          )}
        </div>
      </main>
    </div>
  );
}
