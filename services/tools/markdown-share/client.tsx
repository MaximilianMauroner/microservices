import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";
import { loadMarkdownShareClientConfig } from "./client-config.js";

export function MarkdownShareClient({ children }: { children: ReactNode }) {
  const config = loadMarkdownShareClientConfig(import.meta.env.VITE_CONVEX_URL);
  const client = useMemo(
    () => new ConvexReactClient(config.convexUrl, { unsavedChangesWarning: false }),
    [config.convexUrl],
  );
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
