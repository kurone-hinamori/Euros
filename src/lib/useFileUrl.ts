import { useEffect, useState } from "react";
import { type Kind, fileUrl } from "./storage";

/** 保存した画像を <img> で見せる URL。画面を離れたら解放する */
export function useFileUrl(id: string, file: string | null | undefined, kind: Kind = "characters"): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(undefined);
    if (!file) return;
    let made: string | undefined;
    let alive = true;
    fileUrl(id, file, kind)
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
  }, [id, file, kind]);
  return url;
}
