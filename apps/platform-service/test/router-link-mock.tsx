import type { ComponentProps } from "react";
import { vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const router = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...router,
    Link: ({ to, search, preload: _preload, children, ...props }: ComponentProps<"a"> & { to: string; search?: Record<string, unknown>; preload?: string }) => {
      const parameters = new URLSearchParams();
      for (const [key, value] of Object.entries(search ?? {})) if (value !== undefined) parameters.set(key, String(value));
      const query = parameters.toString();
      return <a {...props} href={`${to}${query ? `?${query}` : ""}`}>{children}</a>;
    }
  };
});
