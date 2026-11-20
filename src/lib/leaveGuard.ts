import { useEffect } from "react";
import { ask } from "@tauri-apps/plugin-dialog";

// 生成中や、保存していない候補がある画面から離れる前に確かめる

let current: string | null = null;

/** message があるあいだ、画面を離れる前に確かめる */
export function useLeaveGuard(message: string | null) {
  useEffect(() => {
    current = message;
    return () => {
      if (current === message) current = null;
    };
  }, [message]);
}

/** 離れてよければ true */
export async function confirmLeave(): Promise<boolean> {
  if (!current) return true;
  const ok = await ask(current, { title: "画面を離れる", kind: "warning", okLabel: "離れる", cancelLabel: "とどまる" });
  if (ok) current = null;
  return ok;
}
