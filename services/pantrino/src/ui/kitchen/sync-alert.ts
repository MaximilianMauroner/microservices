import { useSync } from "../../state";
import { useText } from "../language";
import { useLocalText } from "../local-mode";
import { TEXT } from "./text";

export function useSyncAlert(): { label: string; warn: boolean } | null {
  const { status, pending, notices } = useSync();
  const text = useText(TEXT);
  const localText = useLocalText();
  if (status.kind === "local" && status.persistence === "failed") return { label: localText.failed, warn: true };
  if (status.kind === "failed" || notices.length) return { label: text.failed, warn: true };
  if (status.kind === "offline") return { label: text.offline, warn: false };
  if (pending && status.kind !== "syncing") return { label: text.unsent(pending), warn: false };
  return null;
}

