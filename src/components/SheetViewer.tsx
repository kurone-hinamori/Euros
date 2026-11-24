import { useState } from "react";

/** シートの表示。クリックで原寸に拡大し、スクロールで見て回れる */
export function SheetViewer({ src }: { src?: string }) {
  const [zoom, setZoom] = useState(false);
  if (!src) return null;
  return (
    <div className={`viewer${zoom ? " zoom" : ""}`} title={zoom ? "クリックで全体を表示" : "クリックで原寸に拡大"}>
      <img src={src} alt="キャラクターシート" onClick={() => setZoom(!zoom)} />
    </div>
  );
}
