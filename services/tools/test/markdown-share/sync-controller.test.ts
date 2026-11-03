import { EditorState } from "@tiptap/pm/state";
import { Schema } from "prosemirror-model";
import type { EditorView } from "@tiptap/pm/view";
import { Step } from "@tiptap/pm/transform";
import { collab, getVersion, sendableSteps } from "prosemirror-collab";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyncController, receiveUpdate } from "../../markdown-share/sync-controller.js";
import { ShareError, type SubmitSteps, type SyncUpdate } from "../../markdown-share/types.js";

const schema = new Schema({ nodes: {
  doc: { content: "codeBlock" }, codeBlock: { content: "text*" }, text: {},
} });
const document = { token: "test", filename: "test.md", format: "markdown" as const, pinned: false, createdAt: 0, updatedAt: 0, expiresAt: 1000 };
function client(id: string) {
  const view = {
    state: EditorState.create({ schema, doc: schema.node("doc", null, [schema.node("codeBlock", null, [schema.text("text")])]), plugins: [collab({ clientID: id })] }),
    dispatch(transaction: Parameters<EditorState["apply"]>[0]) { this.state = this.state.apply(transaction); },
  };
  return view as EditorView;
}
function server() {
  const steps: unknown[] = [];
  const clientIds: string[] = [];
  let doc = client("server").state.doc;
  const pull = (version: number): SyncUpdate => ({ document, steps: steps.slice(version), clientIds: clientIds.slice(version), version: steps.length, presence: [], checkpoints: [] });
  const submit = (body: SubmitSteps) => {
    if (body.version === steps.length) {
      for (const json of body.steps) {
        doc = Step.fromJSON(schema, json).apply(doc).doc!;
        steps.push(json);
        clientIds.push(body.clientId);
      }
    }
    return pull(body.version);
  };
  return { pull, submit, text: () => doc.textContent, count: () => steps.length };
}
const pending = (view: EditorView): SubmitSteps => {
  const value = sendableSteps(view.state)!;
  return { version: value.version, clientId: String(value.clientID), steps: value.steps.map((step) => step.toJSON()) };
};
function edit(view: EditorView, text: string) { view.dispatch(view.state.tr.insertText(text, 1)); }
const forever = () => new Promise<SyncUpdate>(() => {});
afterEach(() => vi.useRealTimers());

describe("document synchronization", () => {
  it("rebases real concurrent ProseMirror edits and consumes overlapping responses once", () => {
    const a = client("a"), b = client("b"), remote = server();
    edit(a, "A"); edit(b, "B");
    const ack = remote.submit(pending(a));
    receiveUpdate(a, ack);
    receiveUpdate(b, remote.submit(pending(b)));
    receiveUpdate(b, remote.submit(pending(b)));
    receiveUpdate(a, remote.pull(getVersion(a.state)));
    receiveUpdate(a, ack);
    expect(a.state.doc.textContent).toBe(remote.text());
    expect(b.state.doc.textContent).toBe(remote.text());
    expect(remote.text()).toContain("A");
    expect(remote.text()).toContain("B");
    expect(sendableSteps(a.state)).toBeNull();
    expect(sendableSteps(b.state)).toBeNull();
    expect(getVersion(a.state)).toBe(2);
  });

  it("retries a lost acknowledgement without duplicating the accepted edit", async () => {
    vi.useFakeTimers();
    const view = client("a"), remote = server();
    const errors = vi.fn(), recovered = vi.fn();
    edit(view, "A");
    let lost = true;
    const submit = vi.fn(async (body: SubmitSteps) => {
      const update = remote.submit(body);
      if (lost) { lost = false; throw new Error("connection lost after commit"); }
      return update;
    });
    const controller = createSyncController(view, { pull: forever, submit }, { update: vi.fn(), error: errors, recovered });
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveBeenCalledOnce();
    expect(sendableSteps(view.state)).not.toBeNull();
    edit(view, "B");
    controller.changed();
    await vi.advanceTimersByTimeAsync(510);
    expect(remote.count()).toBe(2);
    expect(remote.text()).toBe("BAtext");
    expect(view.state.doc.textContent).toBe(remote.text());
    expect(sendableSteps(view.state)).toBeNull();
    expect(recovered).toHaveBeenCalled();
    controller.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a save failure visible through a successful read until local edits are acknowledged", async () => {
    vi.useFakeTimers();
    const view = client("a"), remote = server();
    edit(view, "A");
    let finishRead!: (update: SyncUpdate) => void;
    const recovered = vi.fn(), error = vi.fn();
    const submit = vi.fn().mockRejectedValueOnce(new Error("writes unavailable"))
      .mockImplementation(async (body: SubmitSteps) => remote.submit(body));
    const pull = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }))
      .mockImplementation(forever);
    const controller = createSyncController(view, { pull, submit }, { update: vi.fn(), error, recovered });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(error).toHaveBeenCalledOnce();
      finishRead(remote.pull(0));
      await Promise.resolve();
      expect(recovered).not.toHaveBeenCalled();
      expect(view.state.doc.textContent).toBe("Atext");
      expect(sendableSteps(view.state)).not.toBeNull();
      await vi.advanceTimersByTimeAsync(499);
      expect(submit).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sendableSteps(view.state)).toBeNull();
      expect(recovered).toHaveBeenCalledOnce();
    } finally { controller.destroy(); }
  });

  it("recovers acknowledged saves during continuous typing and resets later failure backoff", async () => {
    vi.useFakeTimers();
    const view = client("a"), remote = server();
    edit(view, "A");
    let finishRetry!: () => void;
    const recovered = vi.fn(), error = vi.fn();
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error("first outage"))
      .mockImplementationOnce(async (body: SubmitSteps) => {
        const update = remote.submit(body);
        return new Promise<SyncUpdate>(resolve => { finishRetry = () => resolve(update); });
      })
      .mockRejectedValueOnce(new Error("second outage"))
      .mockImplementation(async (body: SubmitSteps) => remote.submit(body));
    const controller = createSyncController(view, { pull: forever, submit }, { update: vi.fn(), error, recovered });
    try {
      await vi.advanceTimersByTimeAsync(500);
      expect(submit).toHaveBeenCalledTimes(2);
      edit(view, "B");
      controller.changed();
      finishRetry();
      await vi.advanceTimersByTimeAsync(0);
      expect(recovered).toHaveBeenCalledOnce();
      expect(sendableSteps(view.state)).not.toBeNull();
      expect(submit).toHaveBeenCalledTimes(3);
      expect(error).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(499);
      expect(submit).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(submit).toHaveBeenCalledTimes(4);
      expect(sendableSteps(view.state)).toBeNull();
      expect(remote.text()).toBe("BAtext");
    } finally { controller.destroy(); }
  });

  it("preserves local source on terminal history loss and stops retries", async () => {
    vi.useFakeTimers();
    const view = client("a");
    edit(view, "keep me ");
    const error = vi.fn();
    const submit = vi.fn(async () => { throw new ShareError("HISTORY_UNAVAILABLE", "history removed"); });
    const controller = createSyncController(view, { pull: forever, submit }, { update: vi.fn(), error, recovered: vi.fn() });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(submit).toHaveBeenCalledOnce();
    expect(view.state.doc.textContent).toBe("keep me text");
    expect(sendableSteps(view.state)).not.toBeNull();
    expect(error).toHaveBeenCalledOnce();
    controller.destroy();
  });

  it("can consume an own-step poll before the matching POST response", async () => {
    vi.useFakeTimers();
    const view = client("a"), remote = server();
    edit(view, "A");
    let finishPost!: (update: SyncUpdate) => void;
    let finishPoll!: (update: SyncUpdate) => void;
    let response!: SyncUpdate;
    const controller = createSyncController(view, {
      pull: () => new Promise((resolve) => { finishPoll = resolve; }),
      submit: async (body) => { response = remote.submit(body); return new Promise((resolve) => { finishPost = resolve; }); },
    }, { update: vi.fn(), error: vi.fn(), recovered: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    finishPoll(remote.pull(0));
    await Promise.resolve();
    expect(sendableSteps(view.state)).toBeNull();
    finishPost(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(view.state.doc.textContent).toBe("Atext");
    expect(getVersion(view.state)).toBe(1);
    expect(remote.count()).toBe(1);
    controller.destroy();
  });
  it("backs off failed saves up to thirty seconds and cancels retries on destroy", async () => {
    vi.useFakeTimers();
    const view = client("a");
    edit(view, "A");
    const submit = vi.fn(async () => { throw new Error("offline"); });
    const controller = createSyncController(view, { pull: forever, submit }, { update: vi.fn(), error: vi.fn(), recovered: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledTimes(1);
    let attempts = 1;
    for (const delay of [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(submit).toHaveBeenCalledTimes(attempts);
      await vi.advanceTimersByTimeAsync(1);
      attempts += 1;
      expect(submit).toHaveBeenCalledTimes(attempts);
    }
    controller.destroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(submit).toHaveBeenCalledTimes(attempts);
    expect(view.state.doc.textContent).toBe("Atext");
  });

  it("ignores a canceled hidden-tab poll after focus starts a fresh poll", async () => {
    vi.useFakeTimers();
    const view = client("a"), remote = server();
    let finishOld!: (update: SyncUpdate) => void;
    const pull = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; })).mockImplementation(forever);
    const update = vi.fn();
    const controller = createSyncController(view, { pull, submit: async () => remote.pull(0) }, { update, error: vi.fn(), recovered: vi.fn() });
    controller.pause();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pull).toHaveBeenCalledTimes(1);
    controller.resume();
    expect(pull).toHaveBeenCalledTimes(2);
    finishOld(remote.pull(0));
    await vi.advanceTimersByTimeAsync(1000);
    expect(update).not.toHaveBeenCalled();
    expect(pull).toHaveBeenCalledTimes(2);
    controller.destroy();
  });

});
