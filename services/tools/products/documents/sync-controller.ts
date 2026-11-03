import type { EditorView } from "@tiptap/pm/view";
import { Step } from "@tiptap/pm/transform";
import { getVersion, receiveTransaction, sendableSteps } from "prosemirror-collab";
import type { SubmitSteps, SyncUpdate } from "./types.js";

export function receiveUpdate(view: EditorView, update: SyncUpdate): boolean {
  const startVersion = update.version - update.steps.length;
  const version = getVersion(view.state);
  if (startVersion > version) throw new Error("The document update has a gap.");
  const offset = Math.max(0, version - startVersion);
  if (offset >= update.steps.length) return false;
  const clientId = sendableSteps(view.state)?.clientID;
  const clientIds = update.clientIds.slice(offset);
  view.dispatch(receiveTransaction(view.state,
    update.steps.slice(offset).map((step) => Step.fromJSON(view.state.schema, step)), clientIds));
  return clientId !== undefined && clientIds.includes(String(clientId));
}

type SyncTransport = {
  pull: (version: number, signal: AbortSignal) => Promise<SyncUpdate>;
  submit: (steps: SubmitSteps, signal: AbortSignal) => Promise<SyncUpdate>;
};

export function createSyncController(view: EditorView, transport: SyncTransport, callbacks: {
  update: (update: SyncUpdate) => void;
  error: (error: Error) => void;
  recovered: () => void;
}) {
  const abort = new AbortController();
  let stopped = false;
  let paused = false;
  let saving = false;
  let retryAt = 0;
  let failures = 0;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let pollAbort: AbortController | undefined;
  let metadataVersion = getVersion(view.state);
  let pollGeneration = 0;

  const fail = (caught: unknown) => {
    if (stopped) return;
    const error = caught instanceof Error ? caught : new Error("Synchronization failed.");
    if (error.name === "AbortError") return;
    callbacks.error(error);
    const code = "data" in error ? (error.data as { code?: string }).code : undefined;
    if (code === "DOCUMENT_UNAVAILABLE" || code === "HISTORY_UNAVAILABLE") {
      stopped = true;
      abort.abort();
      pollAbort?.abort();
      clearTimeout(saveTimer);
      clearTimeout(pollTimer);
      return;
    }
    failures += 1;
    retryAt = Date.now() + Math.min(30_000, 500 * 2 ** Math.min(failures - 1, 6));
  };
  const accept = (update: SyncUpdate) => {
    if (stopped) return;
    const acknowledgedLocalSteps = receiveUpdate(view, update);
    if (update.version >= metadataVersion) {
      metadataVersion = update.version;
      callbacks.update(update);
    }
    if (acknowledgedLocalSteps || !sendableSteps(view.state)) {
      failures = 0;
      retryAt = 0;
      callbacks.recovered();
    }
  };
  const scheduleSave = () => {
    if (stopped || saving || saveTimer || !sendableSteps(view.state)) return;
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      void save();
    }, Math.max(0, retryAt - Date.now()));
  };
  const save = async () => {
    const pending = sendableSteps(view.state);
    if (stopped || saving || !pending) return;
    saving = true;
    try {
      accept(await transport.submit({ version: pending.version, clientId: String(pending.clientID),
        steps: pending.steps.slice(0, 1000).map((step) => step.toJSON()) }, abort.signal));
    } catch (error) {
      fail(error);
    } finally {
      saving = false;
      scheduleSave();
    }
  };
  const poll = async () => {
    if (stopped || paused) return;
    const generation = pollGeneration;
    pollAbort = new AbortController();
    try {
      const update = await transport.pull(getVersion(view.state), pollAbort.signal);
      if (generation !== pollGeneration) return;
      accept(update);
      scheduleSave();
    } catch (error) {
      fail(error);
    }
    if (!stopped && !paused && generation === pollGeneration) pollTimer = setTimeout(() => void poll(), Math.max(50, retryAt - Date.now()));
  };
  void poll();
  scheduleSave();
  return {
    changed: scheduleSave,
    pause() { paused = true; pollGeneration += 1; clearTimeout(pollTimer); pollAbort?.abort(); },
    resume() {
      if (!paused || stopped) return;
      paused = false;
      void poll();
      scheduleSave();
    },
    destroy() {
      stopped = true;
      abort.abort();
      pollAbort?.abort();
      clearTimeout(saveTimer);
      clearTimeout(pollTimer);
    },
  };
}
