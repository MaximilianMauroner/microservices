import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const assets = new URL("../public/assets/", import.meta.url);

describe("static UI assets", () => {
  test("operations script uses conditional writes and explicit conflicts", async () => {
    const script = await readFile(new URL("ops.js", assets), "utf8");

    expect(script).toContain('"If-Match": `"${currentRevision()}"`');
    expect(script).toContain("response.status === 409");
    expect(script).toContain("showConflict(payload)");
    expect(script).toContain("data-delete-confirmation");
    expect(script).toContain("window.location.reload()");
    expect(script).toContain('deleteDialog.returnValue = ""');
    expect(script.indexOf('deleteDialog.returnValue = ""')).toBeLessThan(
      script.indexOf("deleteDialog.showModal()")
    );
    expect(script).toContain("[data-ops-collection]");
    expect(script).toContain("[data-collection-retry]");
    expect(script).toContain("observation.monitorId");
    expect(script).toContain("Legacy monitor unknown");
    expect(script).not.toContain("setInterval");
    expect(script).toContain("8000");
    expect(script).toContain("AbortController");
    expect(script).toContain("collectionRequests");
    expect(script).toContain("Loading timed out after 8 seconds");
    expect(script).toContain("Your Access session expired");
    expect(script).toContain("The server returned malformed data");
    expect(script).toContain("document.createDocumentFragment()");
    expect(script).toContain("Link IDs must be unique");
  });

  test("resets destructive confirmation before reopen and leaves Escape non-destructive", async () => {
    const script = await readFile(new URL("ops.js", assets), "utf8");

    const openFlow = script.slice(
      script.indexOf("const deleteButton"),
      script.indexOf("if (deleteDialog instanceof HTMLDialogElement)")
    );
    expect(openFlow).toContain('deleteDialog.returnValue = ""');
    expect(openFlow.indexOf('deleteDialog.returnValue = ""')).toBeLessThan(
      openFlow.indexOf("deleteDialog.showModal()")
    );
    expect(script).toContain('if (deleteDialog.returnValue !== "confirm") return;');
  });

  test("assets contain no inline-handler dependency and respect reduced motion", async () => {
    const css = await readFile(new URL("tools.css", assets), "utf8");
    const script = await readFile(new URL("ops.js", assets), "utf8");

    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(":focus-visible");
    expect(script).toContain("addEventListener");
    expect(script).not.toContain("innerHTML");
    expect(script).not.toContain("eval(");
  });

  test("document inventory client filters, sorts, and copies links without unsafe DOM writes", async () => {
    const script = await readFile(new URL("markdown-admin.js", assets), "utf8");

    expect(script).toContain("[data-document-search]");
    expect(script).toContain("[data-document-checkpoints]");
    expect(script).toContain("[data-document-expiry]");
    expect(script).toContain("navigator.clipboard.writeText");
    expect(script).toContain("localeCompare");
    expect(script).not.toContain("innerHTML");
    expect(script).not.toContain("eval(");
  });

  test("keeps the shared navigation and hero usable at compact widths", async () => {
    const css = await readFile(new URL("tools.css", assets), "utf8");

    expect(css).toContain("@media (max-width: 439px)");
    expect(css).toContain(".suite-nav { width: 100%; flex-wrap: wrap; overflow-x: visible;");
    expect(css).toContain(".suite-nav a { flex: 1 1 calc(33.333% - 4px);");
    expect(css).toContain("font-size: 2.125rem");
    expect(css).toContain(".browse-tools { margin-top: 14px;");
    expect(css).toContain(".directory-primary-action");
    expect(css).toContain(".directory-action");
    expect(css).toContain(".uptime-bar-scroll");
    expect(css).toContain("min-width: 540px");
  });
});
