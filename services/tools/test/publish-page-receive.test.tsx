import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReceiveFilesPage, UploadLinkTable, type UploadLinkSummary } from "../publisher/ui/upload-link-manager.js";

const now = Date.parse("2026-09-27T10:00:00.000Z");

const links: UploadLinkSummary[] = [
  { id: "active", createdAt: "2026-09-27T08:12:00.000Z", expiresAt: "2026-09-28T08:12:00.000Z", fileCount: 0 },
  { id: "expired", createdAt: "2026-09-10T11:02:00.000Z", expiresAt: "2026-09-11T11:02:00.000Z", fileCount: 14 },
  { id: "revoked", createdAt: "2026-09-02T09:15:00.000Z", expiresAt: "2026-10-02T09:15:00.000Z", revokedAt: "2026-09-03T09:15:00.000Z", fileCount: 2 }
];

describe("Receive files", () => {
  it("shows the page header with the duration choice and one primary action", () => {
    const html = renderToStaticMarkup(<ReceiveFilesPage />);

    expect(html).toContain("Receive files");
    expect(html).toContain("People with an active link can send you files without signing in.");
    expect(html).toContain('aria-label="Link duration"');
    expect(html).toContain("Create link");
  });

  it("shows active, expired and revoked links with their actions", () => {
    const html = renderToStaticMarkup(<UploadLinkTable links={links} busy={false} hasMore onRevoke={() => undefined} onLoadOlder={() => undefined} now={now} />);

    expect(html.match(/>Active</g)).toHaveLength(1);
    expect(html.match(/>Expired</g)).toHaveLength(1);
    expect(html.match(/>Revoked</g)).toHaveLength(1);
    // Download all appears only for links that received files.
    expect(html).not.toContain("/api/upload-links/active/download");
    expect(html).toContain("/api/upload-links/expired/download");
    expect(html).toContain("/api/upload-links/revoked/download");
    // Revoke stays available for every link the server has not revoked, whatever the browser clock says.
    expect(html.match(/>Revoke</g)).toHaveLength(2);
    expect(html).toContain("Older links cannot show their URL again. Make a new link instead.");
    expect(html).toContain("Load older");
  });
});
