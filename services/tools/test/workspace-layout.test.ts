import { describe, expect, it } from "vitest";
import { isWorkspacePath } from "../src/routes/__root.js";

describe("workspace layout", () => {
  it.each(["/", "/documents", "/feedback", "/feedback/forms/form-1", "/field-guide", "/money", "/publisher", "/publisher/artifacts", "/settings", "/status"])("adds workspace navigation to %s", (pathname) => {
    expect(isWorkspacePath(pathname)).toBe(true);
  });

  it.each(["/sign-in", "/feedback/f/public-token", "/markdown", "/markdown/d/notes.md--token", "/artifacts/public-id", "/files/public-id", "/health"])("keeps public or infrastructure route %s outside the workspace shell", (pathname) => {
    expect(isWorkspacePath(pathname)).toBe(false);
  });
});
