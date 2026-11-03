// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import CodeBlock from "@tiptap/extension-code-block";
import Text from "@tiptap/extension-text";
import { getVersion, sendableSteps } from "prosemirror-collab";
import { afterEach, expect, it, vi } from "vitest";
import { documentSyncExtension } from "../../../products/documents/sync-extension.js";
import type { SubmitSteps, SyncUpdate } from "../../../products/documents/types.js";

const liveDocument = { token: "test", filename: "test.md", format: "markdown" as const, pinned: false, createdAt: 0, updatedAt: 0, expiresAt: 1000 };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("runs the actual TipTap sync extension, protects unsent text and removes the unload guard", async () => {
  vi.useFakeTimers();
  let submit!: SubmitSteps;
  let finish!: (response: Response) => void;
  const fetch = vi.fn((url: string, options: RequestInit) => {
    if (url.endsWith("/steps")) {
      submit = JSON.parse(options.body as string);
      return new Promise<Response>((resolve) => { finish = resolve; });
    }
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal("fetch", fetch);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [Document, CodeBlock, Text, documentSyncExtension({ token: "test", version: 0, onUpdate: vi.fn(), onError: vi.fn(), onRecovered: vi.fn() })],
    content: { type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "initial" }] }] },
  });
  editor.view.dispatch(editor.state.tr.insertText("local ", 1));
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(submit.version).toBe(0);
  const update: SyncUpdate = { document: liveDocument, version: 1, steps: submit.steps, clientIds: [submit.clientId], checkpoints: [], presence: [] };
  finish(new Response(JSON.stringify(update), { headers: { "Content-Type": "application/json" } }));
  await vi.advanceTimersByTimeAsync(0);
  expect(editor.state.doc.textContent).toBe("local initial");
  expect(getVersion(editor.state)).toBe(1);
  expect(sendableSteps(editor.state)).toBeNull();
  const savedUnload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(savedUnload);
  expect(savedUnload.defaultPrevented).toBe(false);
  editor.view.dispatch(editor.state.tr.insertText("unsent ", 1));
  editor.destroy();
  const afterDestroy = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(afterDestroy);
  expect(afterDestroy.defaultPrevented).toBe(false);
  const requestsBeforeDestroy = fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetch).toHaveBeenCalledTimes(requestsBeforeDestroy);
  expect(vi.getTimerCount()).toBe(0);
});
