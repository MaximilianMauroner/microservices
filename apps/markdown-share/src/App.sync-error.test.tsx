// @vitest-environment jsdom

import { ConvexError } from "convex/values";
import { getFunctionName, type AnyFunctionReference } from "convex/server";
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
  useQuery: (reference: AnyFunctionReference) => {
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

import { App } from "./App";

describe("sync error UI", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    reportSyncError = undefined;
    window.history.replaceState(null, "", `/d/sync-errors.md--${TOKEN}`);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
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
