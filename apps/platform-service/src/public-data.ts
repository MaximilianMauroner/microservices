import { createServerFn } from "@tanstack/react-start";
import { getPlatformRuntime } from "./runtime.js";

export const getPublicPageData = createServerFn({ method: "GET" }).handler(
  async () => {
    const runtime = await getPlatformRuntime();
    return {
      publicOrigin: runtime.publicOrigin,
      snapshot: await runtime.publicSnapshot()
    };
  }
);
