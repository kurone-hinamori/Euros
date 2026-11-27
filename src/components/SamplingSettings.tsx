import { useEffect, useState } from "react";
import type { SamplingMode, SamplingParams, Settings } from "../types";
import { comfySamplerLists, engineOf, SAMPLING_LIMITS, SAMPLING_MODE_LABEL, samplingModes, validCfg, validSteps } from "../lib/comfy";
import { parseNumber } from "../lib/figure";

/** 選べる名前の一覧に、既定値といまの値がなければ足す(ComfyUI に接続できないときも選べるように) */
const withNames = (list: string[], ...names: (string | undefined)[]) => [...new Set([...names.filter((n): n is string => !!n), ...list])];

/** 画像生成のステップ数・CFG・サンプラー・スケジューラー。空の項目はモデルの既定値を使う */
export function SamplingSettings({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const def = engineOf(settings.imageEngine);
  const own = settings.sampling?.[def.id] ?? {};
  const [lists, setLists] = useState<{ samplers: string[]; schedulers: string[] }>({ samplers: [], schedulers: [] });

  useEffect(() => {
    let alive = true;
    comfySamplerLists(settings)
      .then((l) => alive && setLists(l))
      .catch(() => alive && setLists({ samplers: [], schedulers: [] }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.comfyUrl]);

  const set = (mode: SamplingMode, patch: SamplingParams) => {
    const next: SamplingParams = { ...own[mode], ...patch };
    for (const k of Object.keys(next) as (keyof SamplingParams)[]) if (next[k] === undefined || next[k] === "") delete next[k];
    const modes = { ...own, [mode]: next };
    if (!Object.keys(next).length) delete modes[mode];
    onChange({ ...settings, sampling: { ...settings.sampling, [def.id]: modes } });
  };

  const reset = () => {
    const { [def.id]: _, ...rest } = settings.sampling ?? {};
    onChange({ ...settings, sampling: rest });
  };

  const customized = Object.keys(own).length > 0;

  return (
    <>
      <h3>生成のパラメーター({def.label})</h3>
      <p className="muted small-text" style={{ marginTop: 0 }}>
        空の項目はモデルの既定値を使います。ステップ数は {SAMPLING_LIMITS.steps.min}〜{SAMPLING_LIMITS.steps.max} の整数、CFG は {SAMPLING_LIMITS.cfg.min}{" "}
        より大きく {SAMPLING_LIMITS.cfg.max} 以下です。
      </p>
      {samplingModes(def).map((mode) => {
        const base = def.sampling[mode] ?? def.sampling.text;
        const p = own[mode] ?? {};
        const badSteps = p.steps !== undefined && !validSteps(p.steps);
        const badCfg = p.cfg !== undefined && !validCfg(p.cfg);
        return (
          <div key={mode}>
            {samplingModes(def).length > 1 && (
              <p className="small-text" style={{ margin: "0 0 6px" }}>
                {SAMPLING_MODE_LABEL[mode]}
              </p>
            )}
            <div className="sampling">
              <label className="field">
                <span>ステップ数(既定 {base.steps})</span>
                <input
                  type="number"
                  min={SAMPLING_LIMITS.steps.min}
                  max={SAMPLING_LIMITS.steps.max}
                  step={1}
                  placeholder={String(base.steps)}
                  value={p.steps ?? ""}
                  onChange={(e) => set(mode, { steps: parseNumber(e.target.value) })}
                />
                {badSteps && <small className="error">範囲外のため、既定値 {base.steps} を使います</small>}
              </label>
              <label className="field">
                <span>CFG(既定 {base.cfg})</span>
                <input
                  type="number"
                  min={SAMPLING_LIMITS.cfg.min}
                  max={SAMPLING_LIMITS.cfg.max}
                  step={0.1}
                  placeholder={String(base.cfg)}
                  value={p.cfg ?? ""}
                  onChange={(e) => set(mode, { cfg: parseNumber(e.target.value) })}
                />
                {badCfg && <small className="error">範囲外のため、既定値 {base.cfg} を使います</small>}
              </label>
              <label className="field">
                <span>サンプラー</span>
                <select value={p.sampler ?? ""} onChange={(e) => set(mode, { sampler: e.target.value })}>
                  <option value="">既定({base.sampler})</option>
                  {withNames(lists.samplers, p.sampler).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>スケジューラー</span>
                <select value={p.scheduler ?? ""} onChange={(e) => set(mode, { scheduler: e.target.value })}>
                  <option value="">既定({base.scheduler})</option>
                  {withNames(lists.schedulers, p.scheduler).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        );
      })}
      <div className="row">
        <button className="small" disabled={!customized} onClick={reset}>
          既定に戻す
        </button>
      </div>
    </>
  );
}
