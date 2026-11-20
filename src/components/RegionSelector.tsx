import { useRef, useState } from "react";
import type { Box1000 } from "../types";
import { SHEET_REGIONS } from "../lib/sheet";

const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));

/** 描き直す範囲を、シートの上でドラッグして選ぶ(0〜1000 の [上, 左, 下, 右]) */
export function RegionSelector(props: { src?: string; boxes: Box1000[]; onChange: (boxes: Box1000[]) => void; disabled?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);

  const pos = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: clamp(((e.clientX - r.left) / r.width) * 1000), y: clamp(((e.clientY - r.top) / r.height) * 1000) };
  };

  const finish = () => {
    if (!drag) return;
    const box: Box1000 = [Math.min(drag.y, drag.y2), Math.min(drag.x, drag.x2), Math.max(drag.y, drag.y2), Math.max(drag.x, drag.x2)];
    setDrag(null);
    // 小さすぎる範囲(クリックしただけ)は足さない
    if (box[2] - box[0] > 15 && box[3] - box[1] > 15) props.onChange([...props.boxes, box]);
  };

  const style = ([y0, x0, y1, x1]: Box1000) => ({ top: `${y0 / 10}%`, left: `${x0 / 10}%`, height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%` });

  return (
    <div>
      <div className="row">
        <span className="muted small-text">シートの上をドラッグして範囲を選ぶか、区画を選びます:</span>
        {SHEET_REGIONS.map((r) => (
          <button key={r.label} className="small" disabled={props.disabled} onClick={() => props.onChange([...props.boxes, r.box])}>
            {r.label}
          </button>
        ))}
        {props.boxes.length > 0 && (
          <button className="small ghost" disabled={props.disabled} onClick={() => props.onChange([])}>
            範囲をすべて消す
          </button>
        )}
      </div>
      <div
        ref={wrap}
        className="region"
        onPointerDown={(e) => {
          if (props.disabled || !wrap.current) return;
          wrap.current.setPointerCapture(e.pointerId);
          const p = pos(e);
          setDrag({ x: p.x, y: p.y, x2: p.x, y2: p.y });
        }}
        onPointerMove={(e) => drag && setDrag({ ...drag, ...((p) => ({ x2: p.x, y2: p.y }))(pos(e)) })}
        onPointerUp={finish}
        onPointerCancel={() => setDrag(null)}
      >
        {props.src && <img src={props.src} alt="" draggable={false} />}
        {props.boxes.map((b, i) => (
          <div key={i} className="region-box" style={style(b)}>
            <button
              className="small"
              disabled={props.disabled}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => props.onChange(props.boxes.filter((_, j) => j !== i))}
              title="この範囲を消す"
            >
              ×
            </button>
          </div>
        ))}
        {drag && <div className="region-box drawing" style={style([Math.min(drag.y, drag.y2), Math.min(drag.x, drag.x2), Math.max(drag.y, drag.y2), Math.max(drag.x, drag.x2)])} />}
      </div>
    </div>
  );
}
