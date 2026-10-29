import { useMemo, type ReactNode } from "react";
import { applyStoredTheme } from "./theme.js";

export function MarkdownShareClient({ children }: { children: ReactNode }) {
  useMemo(() => applyStoredTheme(), []);
  return children;
}
