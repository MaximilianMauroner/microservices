import postgres from "postgres";
import { createHash } from "node:crypto";

type Waiter = { key: string; finish(): void };
type Listener = { sql: ReturnType<typeof postgres>; waiters: Set<Waiter>; ready: Promise<void>; listening: boolean; idleTimer?: ReturnType<typeof setTimeout> };

export function createDocumentChanges(databaseUrl: string) {
  let active: Listener | undefined;
  let closed = false;
  const closing = new Set<Promise<void>>();
  function release(listener: Listener) {
    clearTimeout(listener.idleTimer);
    if (active === listener) active = undefined;
    const end = listener.ready.catch(() => {}).then(() => listener.sql.end({ timeout: 1 })).catch(() => {});
    closing.add(end);
    void end.then(() => closing.delete(end));
  }
  function listener(): Listener {
    if (active) return active;
    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 30, connect_timeout: 5, connection: { application_name: "markdown-share-changes" } });
    const state: Listener = { sql, waiters: new Set(), ready: Promise.resolve(), listening: false };
    active = state;
    state.ready = sql.listen("markdown_share", payload => {
      for (const waiter of [...state.waiters]) if (waiter.key === payload) waiter.finish();
    }, () => {
      if (state.listening) for (const waiter of [...state.waiters]) waiter.finish();
      state.listening = true;
    }).then(() => {}).catch(error => {
      for (const waiter of [...state.waiters]) waiter.finish();
      release(state);
      throw error;
    });
    return state;
  }
  function subscribe(token: string, signal?: AbortSignal, timeoutMs = 20_000) {
    if (closed) throw new Error("Document change listener is closed.");
    const state = listener();
    clearTimeout(state.idleTimer);
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waiter: Waiter = { key: createHash("sha256").update(token).digest("hex"), finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", waiter.finish);
      state.waiters.delete(waiter);
      resolve();
      if (!state.waiters.size) {
        state.idleTimer = setTimeout(() => release(state), 2000);
        state.idleTimer.unref();
      }
    } };
    state.waiters.add(waiter);
    timer = setTimeout(waiter.finish, Math.min(Math.max(timeoutMs, 1), 30_000));
    signal?.addEventListener("abort", waiter.finish, { once: true });
    if (signal?.aborted) waiter.finish();
    return { ready: state.ready, promise, cancel: waiter.finish };
  }
  return {
    subscribe,
    async wait(token: string, signal: AbortSignal, timeoutMs = 20_000): Promise<void> {
      const subscription = subscribe(token, signal, timeoutMs);
      try { await subscription.ready; await subscription.promise; } finally { subscription.cancel(); }
    },
    async close(): Promise<void> {
      closed = true;
      if (active) {
        const state = active;
        for (const waiter of [...state.waiters]) waiter.finish();
        if (active === state) release(state);
      }
      await Promise.all([...closing]);
    },
  };
}
