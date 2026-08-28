// @vitest-environment jsdom

import { ConvexError } from "convex/values";
import { getFunctionName, type FunctionReference } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SyncOptions = {
  onSyncError?: (error: Error) => void;
};

const TOKEN = "abcdefghijklmnopqrst";
const publicDocument = {
  token: TOKEN,
  filename: "sync-errors.md",
  createdAt: 1_000,
  updatedAt: 1_000,
  expiresAt: Date.now() + 60_000,
};
let reportSyncError: ((error: Error) => void) | undefined;

vi.mock("@convex-dev/presence/react", () => ({
  default: () => [],
}));

vi.mock("convex/react", () => ({
  useMutation: () => async () => null,
  useQuery: (reference: FunctionReference<"query">) => {
    switch (getFunctionName(reference)) {
      case "documents:get":
        return publicDocument;
      case "checkpoints:list":
        return [];
      default:
        return undefined;
    }
  },
}));

vi.mock("@convex-dev/prosemirror-sync/tiptap", async () => {
  const { Extension } = await vi.importActual<typeof import("@tiptap/core")>(
    "@tiptap/core",
  );
  const { collab } = await vi.importActual<
    typeof import("prosemirror-collab")
  >("prosemirror-collab");
  const extension = Extension.create({
    name: "test-sync",
    addProseMirrorPlugins() {
      return [collab({ version: 1 })];
    },
  });

  return {
    useTiptapSync: (_api: unknown, _id: string, options?: SyncOptions) => {
      reportSyncError = options?.onSyncError;
      return {
        extension,
        isLoading: false,
        initialContent: {
          type: "doc",
          content: [
            {
              type: "codeBlock",
              content: [{ type: "text", text: "initial" }],
            },
          ],
        },
      };
    },
  };
});

import { CollaborativeWorkspace } from "./collaborative-workspace.js";

describe("collaborative workspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    reportSyncError = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<CollaborativeWorkspace document={publicDocument} />);
    });
  });

  it("switches between the source and preview panes", async () => {
    const sourcePanel = container.querySelector("#source-panel");
    const previewPanel = container.querySelector("#preview-panel");
    const previewTab = container.querySelector<HTMLButtonElement>(
      "#mobile-preview-tab",
    );

    expect(sourcePanel?.classList.contains("mobile-active")).toBe(true);
    expect(previewPanel?.classList.contains("mobile-inactive")).toBe(true);

    await act(async () => {
      previewTab?.click();
    });

    expect(sourcePanel?.classList.contains("mobile-inactive")).toBe(true);
    expect(previewPanel?.classList.contains("mobile-active")).toBe(true);
    expect(previewTab?.getAttribute("aria-selected")).toBe("true");
  });

  it("sets the preview custom properties used by the stylesheet", () => {
    const workspace = container.querySelector<HTMLElement>(".editor-shell");

    expect(
      workspace?.style.getPropertyValue(
        "--markdown-share-preview-font-scale",
      ),
    ).toBe("1");
    expect(
      workspace?.style.getPropertyValue(
        "--markdown-share-preview-line-height",
      ),
    ).toBe("1.7");
    expect(workspace?.style.getPropertyValue("--preview-font-scale")).toBe("");
    expect(workspace?.style.getPropertyValue("--preview-line-height")).toBe("");
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps a retryable error visible without disabling editing", async () => {
    expect(reportSyncError).toBeDefined();

    await act(async () => {
      reportSyncError?.(new Error("temporary failure"));
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "may not be saved",
    );
    expect(container.querySelector(".save-status-error")?.textContent).toContain(
      "Save failed",
    );
    expect(container.querySelector(".tiptap")?.getAttribute("contenteditable"))
      .toBe("true");

    const historyButton = container.querySelector<HTMLButtonElement>(
      ".history-control-desktop .history-trigger",
    );
    await act(async () => {
      historyButton?.click();
    });
    const checkpointButton = container.querySelector<HTMLButtonElement>(
      ".history-control-desktop .history-menu button",
    );
    expect(checkpointButton?.disabled).toBe(false);
  });

  it("latches document unavailability and disables editing and checkpoints", async () => {
    expect(reportSyncError).toBeDefined();

    await act(async () => {
      reportSyncError?.(new Error("temporary failure"));
    });

    await act(async () => {
      reportSyncError?.(
        new ConvexError({
          code: "DOCUMENT_UNAVAILABLE",
          message: "expired",
        }),
      );
    });
    await act(async () => {
      reportSyncError?.(new Error("later retryable failure"));
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("no longer available");
    expect(alert?.textContent).not.toContain("try editing again");
    expect(container.querySelector(".tiptap")?.getAttribute("contenteditable"))
      .toBe("false");
    expect(container.querySelector(".save-status-error")?.textContent).toContain(
      "Save failed",
    );

    const historyButton = container.querySelector<HTMLButtonElement>(
      ".history-control-desktop .history-trigger",
    );
    await act(async () => {
      historyButton?.click();
    });
    const checkpointButton = container.querySelector<HTMLButtonElement>(
      ".history-control-desktop .history-menu button",
    );
    expect(checkpointButton?.disabled).toBe(true);
  });
});
