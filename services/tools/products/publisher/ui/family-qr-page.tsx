import { useEffect, useRef, useState } from "react";
import { AppShell } from "../../../platform/ui/components/app-shell.js";
import { PageHeader } from "../../../platform/ui/components/page-header.js";
import { Alert } from "../../../platform/ui/components/ui/alert.js";
import { Button } from "../../../platform/ui/components/ui/button.js";
import { Card } from "../../../platform/ui/components/ui/card.js";
import { Input } from "../../../platform/ui/components/ui/input.js";
import { favicons } from "../../../platform/ui/favicons.js";
import type { UploadSummary } from "../../../platform/protected-data.js";
import { uploadDirectFile } from "./direct-upload.js";
import { familyQrFile, FAMILY_QR_PROJECT } from "./family-qr.js";

export function FamilyQrPage({ initial }: { initial: UploadSummary | null }) {
  const [shared, setShared] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const operation = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => operation.current?.abort(), []);

  async function upload(image: File) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setMessage("");
    try {
      const file = await familyQrFile(image);
      const result = await uploadDirectFile(file, {
        onProgress: () => {},
        onProcessing: () => {},
        registerXhr: () => {},
        isCancelled: () => controller.signal.aborted,
        signal: controller.signal
      }, { kind: "html", project: FAMILY_QR_PROJECT, ...(shared ? { replaceId: shared.id } : {}) });
      setShared(result);
      setMessage("Screenshot published. Your family can use the share link below.");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Upload failed. Try again.");
    } finally {
      operation.current = null;
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function copyLink() {
    if (!shared) return;
    try {
      await navigator.clipboard.writeText(shared.url);
      setMessage("Share link copied.");
    } catch {
      setMessage("Could not copy the link. Select and copy it from the field below.");
    }
  }

  return <>
    <AppShell product="Publisher" accent="violet" icon={favicons.publisher} />
    <main id="main" className="tools-page">
      <PageHeader title="Family QR" facts="Upload a fresh screenshot. Keep the same share link." />
      <Card className="max-w-2xl gap-4 p-6">
        <p>Open the family verification QR in Spotify. Take a screenshot and upload it here. Each upload replaces the image at your existing share link.</p>
        <Alert>Spotify changes its code every few seconds. A screenshot may expire before someone scans it. Uploading does not extend its life.</Alert>
        <label htmlFor="family-qr-image" className="text-sm font-medium">QR screenshot</label>
        <Input id="family-qr-image" ref={input} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
          onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); }} />
        <p className="text-sm text-muted-foreground">PNG, JPEG, or WebP. Maximum 4 MB. Crop out private information before uploading. Anyone with the link can see the screenshot.</p>
        <p role="status" aria-live="polite">{busy ? "Publishing screenshot..." : message}</p>
        {shared ? <section className="grid gap-3" aria-label="Permanent share link">
          <label htmlFor="family-qr-link" className="text-sm font-medium">Permanent share link</label>
          <Input id="family-qr-link" readOnly value={shared.url} onFocus={event => event.currentTarget.select()} />
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => void copyLink()}>Copy link</Button>
            <Button nativeButton={false} variant="outline" render={<a href={shared.url} target="_blank" rel="noreferrer" />}>Open shared page</Button>
          </div>
          <p className="text-sm text-muted-foreground">Last upload {shared.updatedAt}. The shared page refreshes every 3 seconds. Open it on a second screen to scan with a phone. You can revoke this link in Library.</p>
        </section> : <p className="text-sm text-muted-foreground">Your first upload creates the permanent share link.</p>}
      </Card>
    </main>
  </>;
}
