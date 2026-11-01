import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PublishPage, applyFileExpiry, capabilityUrlText } from "../publisher/ui/publish-page.js";
import type { UploadSummary } from "../src/protected-data.js";

const now = Date.parse("2026-09-27T10:00:00.000Z");

const uploads: UploadSummary[] = [
  {
    id: "a".repeat(32),
    kind: "file",
    filename: "notes.txt",
    contentType: "text/plain",
    url: `https://tools.example.test/files/${"a".repeat(32)}/notes.txt`,
    bytes: 1024,
    updatedAt: "2026-09-27T10:00:00.000Z",
    expiresAt: "2026-09-30T10:00:00.000Z"
  },
  {
    id: "b".repeat(32),
    kind: "html",
    filename: "plan.html",
    contentType: "text/html",
    url: `https://tools.example.test/artifacts/${"b".repeat(32)}`,
    bytes: 2048,
    updatedAt: "2026-09-27T10:01:00.000Z"
  }
];

function patchFetcher(expiresAt: string | null) {
  return vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: uploads[0]!.id, expiresAt }));
}

describe("Publisher upload page", () => {
  it("offers the drop zone, the upload options and the recent artifacts", () => {
    const html = renderToStaticMarkup(<PublishPage />);

    expect(html).toContain("Drop a file to get a link.");
    expect(html).toContain('type="file"');
    expect(html).toContain('multiple=""');
    expect(html).toContain("Drop files here");
    expect(html).toContain("Choose files");
    expect(html).toContain('aria-pressed="true">3 days</button>');
    expect(html).toContain("Permanent");
    expect(html).toContain('aria-label="Project for HTML plans"');
    expect(html).toContain("Recent");
    expect(html).toContain('href="/publisher/artifacts"');
    expect(html).not.toContain("Guest upload links");
    expect(html).not.toContain("Upload policy");
  });

  it("formats all capability URLs as newline-separated clipboard text", () => {
    expect(capabilityUrlText(uploads)).toBe(`${uploads[0]!.url}\n${uploads[1]!.url}`);
  });
});

describe("File expiry after upload", () => {
  it("sends no request for the 3-day server default", async () => {
    const fetcher = patchFetcher(null);

    await expect(applyFileExpiry(uploads[0]!, "3", fetcher, now)).resolves.toEqual(uploads[0]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends a null expiry for Permanent and drops the default expiry", async () => {
    const fetcher = patchFetcher(null);

    const updated = await applyFileExpiry(uploads[0]!, "permanent", fetcher, now);

    expect(fetcher).toHaveBeenCalledWith(`/api/external-uploads/${uploads[0]!.id}`, expect.objectContaining({ method: "PATCH", body: '{"expiresAt":null}' }));
    expect(updated.expiresAt).toBeUndefined();
  });

  it("sends the chosen number of days from now", async () => {
    const fetcher = patchFetcher("2026-10-04T10:00:00.000Z");

    const updated = await applyFileExpiry(uploads[0]!, "7", fetcher, now);

    expect(fetcher.mock.calls[0]?.[1]?.body).toBe('{"expiresAt":"2026-10-04T10:00:00.000Z"}');
    expect(updated.expiresAt).toBe("2026-10-04T10:00:00.000Z");
  });

  it("leaves HTML plans alone", async () => {
    const fetcher = patchFetcher(null);

    await applyFileExpiry(uploads[1]!, "1", fetcher, now);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports the server message when the update fails", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: "File expiry must be in the future." }, { status: 400 }));

    await expect(applyFileExpiry(uploads[0]!, "1", fetcher, now)).rejects.toThrow("File expiry must be in the future.");
  });
});
