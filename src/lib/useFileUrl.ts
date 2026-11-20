import { useEffect, useState } from "react";
import { fileUrl } from "./storage";

/** 保存した画像を <img> で見せる URL。画面を離れたら解放する */
export function useFileUrl(id: string, file: string | null | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(undefined);
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
  return url;
}
