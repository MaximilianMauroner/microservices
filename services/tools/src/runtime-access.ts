import type { PlatformRuntime } from "./runtime.js";

let runtimeModule: Promise<typeof import("./runtime.js")> | undefined;

/** Liveness and shutdown do not load product SDKs before the first application request. */
export async function getPlatformRuntime(): Promise<PlatformRuntime> {
  if (!runtimeModule) {
    const pending = import("./runtime.js").catch((error: unknown) => {
      if (runtimeModule === pending) runtimeModule = undefined;
      throw error;
    });
    runtimeModule = pending;
  }
  const loaded = runtimeModule;
  const runtime = await loaded;
  return runtime.getPlatformRuntime();
}

export async function closePlatformRuntime(): Promise<void> {
  if (runtimeModule) await (await runtimeModule).closePlatformRuntime();
}
