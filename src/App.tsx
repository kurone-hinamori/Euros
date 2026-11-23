import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Settings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { loadSettings, saveSettings } from "./lib/storage";
import { CharacterList } from "./components/CharacterList";
import { SettingsView } from "./components/SettingsView";
import { UpdateBanner } from "./components/UpdateBanner";
import { NewCharacter } from "./components/NewCharacter";
import { CharacterDetail } from "./components/CharacterDetail";
import { EditCharacter } from "./components/EditCharacter";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OutfitList } from "./components/OutfitList";
import { EquipmentList } from "./components/EquipmentList";
import { confirmLeave } from "./lib/leaveGuard";

export type View =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "detail"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "outfits" }
  | { kind: "equipment" }
  | { kind: "settings" };

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
    getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  const changeSettings = (s: Settings) => {
    setSettings(s);
    void saveSettings(s).catch(() => undefined);
  };

  /** 生成中などは確かめてから移る */
  const go = (target: View) => {
    void confirmLeave().then((ok) => ok && setView(target));
  };

  const nav = (label: string, target: View, active: boolean) => (
    <button
      className={`nav${active ? " active" : ""}`}
      onClick={() => go(target)}
    >
      {label}
    </button>
  );

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">EUROS</div>
        {nav(
          "キャラクター",
          { kind: "list" },
          view.kind === "list" ||
            view.kind === "detail" ||
            view.kind === "edit" ||
            view.kind === "new",
        )}
        {nav("衣装", { kind: "outfits" }, view.kind === "outfits")}
        {nav("装備品", { kind: "equipment" }, view.kind === "equipment")}
        <div className="spacer" />
        {nav("設定", { kind: "settings" }, view.kind === "settings")}
        {version && <div className="version">v{version}</div>}
      </aside>
      <main className="main">
        <UpdateBanner />
        <div className="content">
          <ErrorBoundary
            key={
              view.kind === "detail" || view.kind === "edit"
                ? `${view.kind}:${view.id}`
                : view.kind
            }
            onBack={() => setView({ kind: "list" })}
          >
            {!ready ? null : view.kind === "list" ? (
              <CharacterList
                settings={settings}
                onOpen={(id) => setView({ kind: "detail", id })}
                onNew={() => setView({ kind: "new" })}
              />
            ) : view.kind === "new" ? (
              <NewCharacter
                settings={settings}
                onCreated={(id) => setView({ kind: "detail", id })}
              />
            ) : view.kind === "detail" ? (
              <CharacterDetail
                id={view.id}
                settings={settings}
                onBack={() => setView({ kind: "list" })}
                onEdit={(id) => setView({ kind: "edit", id })}
              />
            ) : view.kind === "edit" ? (
              <EditCharacter
                id={view.id}
                settings={settings}
                onDone={(id) => setView({ kind: "detail", id })}
                onCancel={() => go({ kind: "detail", id: view.id })}
              />
            ) : view.kind === "outfits" ? (
              <OutfitList settings={settings} />
            ) : view.kind === "equipment" ? (
              <EquipmentList settings={settings} />
            ) : (
              <SettingsView settings={settings} onChange={changeSettings} />
            )}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
