import { ConvexProvider, ConvexReactClient } from "convex/react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element is missing.");
}

if (!convexUrl) {
  createRoot(rootElement).render(
    <main className="configuration-error">
      <p className="eyebrow">Configuration needed</p>
      <h1>Markdown Share needs a Convex deployment URL.</h1>
      <p>Set VITE_CONVEX_URL, then rebuild the frontend.</p>
    </main>,
  );
} else {
  const convex = new ConvexReactClient(convexUrl, {
    // The editor has its own precise pending-step guard. The client-wide guard
    // also counts background mutations (presence, snapshots, checkpoints),
    // which can otherwise produce a misleading leave-page prompt.
    unsavedChangesWarning: false,
  });
  createRoot(rootElement).render(
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>,
  );
}
