import type { ReactNode } from "react";
import { Badge } from "../../src/components/ui/badge.js";
import { cn } from "../../src/lib/utils.js";
import type { UploadSummary } from "../../src/protected-data.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The full link in one field, with its actions at the end. */
export function UrlBox({ url, children }: { url: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-[0.625rem] border border-control-border bg-field py-1 pr-1 pl-2.5">
      <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]" title={url}>{url}</code>
      {children}
    </div>
  );
}

export function ArtifactIcon({ kind, icon }: { kind: UploadSummary["kind"]; icon: ReactNode }) {
  return (
    <span className="grid size-7.5 shrink-0 place-items-center rounded-lg border text-muted-foreground [&_svg]:size-4" aria-hidden="true" data-kind={kind}>
      {icon}
    </span>
  );
}

type Lifecycle = { label: string; tone: "plan" | "warning" | "neutral"; fractionLeft?: number };

/** HTML plans persist, files without an expiry are permanent, and other files show the time left. */
export function lifecycle(upload: UploadSummary, now = Date.now()): Lifecycle {
  if (upload.kind === "html") return { label: "Persistent", tone: "plan" };
  if (!upload.expiresAt) return { label: "Permanent", tone: "neutral" };
  const expires = new Date(upload.expiresAt).getTime();
  const remaining = expires - now;
  const lifetime = expires - new Date(upload.updatedAt).getTime();
  const fractionLeft = lifetime > 0 ? Math.min(1, Math.max(0, remaining / lifetime)) : 0;
  return {
    label: remaining > 0 ? `${timeLeft(remaining)} left` : "Expired",
    tone: remaining <= DAY ? "warning" : "neutral",
    fractionLeft
  };
}

export function LifecycleBadge({ upload, now, accentPlans = false }: { upload: UploadSummary; now?: number; accentPlans?: boolean }) {
  const { label, tone } = lifecycle(upload, now);
  const variant = tone === "warning" ? "warning" : tone === "plan" && accentPlans ? "secondary" : "outline";
  return <Badge variant={variant}>{label}</Badge>;
}

export function expiresWithinDay(upload: UploadSummary, now = Date.now()) {
  if (!upload.expiresAt) return false;
  const remaining = new Date(upload.expiresAt).getTime() - now;
  return remaining > 0 && remaining <= DAY;
}

function timeLeft(remaining: number) {
  if (remaining < HOUR) return `${Math.max(1, Math.ceil(remaining / 60_000))} min`;
  if (remaining < DAY) return `${Math.ceil(remaining / HOUR)} h`;
  return `${Math.ceil(remaining / DAY)} d`;
}

export function relativeTime(value: string, now = Date.now()) {
  const elapsed = now - new Date(value).getTime();
  if (elapsed < 60_000) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  if (elapsed < 2 * DAY) return "yesterday";
  return `${Math.floor(elapsed / DAY)} d ago`;
}

/** Host and path, with long identifiers shortened to their first and last characters. */
export function shortUrl(value: string) {
  const url = new URL(value);
  const path = url.pathname
    .split("/")
    .map((segment) => (segment.length > 16 ? `${segment.slice(0, 3)}…${segment.slice(-3)}` : segment))
    .join("/");
  return `${url.host}${path}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** A small bar for the share of a file's lifetime that is left. */
export function TimeLeftBar({ fraction, warning }: { fraction: number; warning: boolean }) {
  return (
    <span className="mt-1 block h-1 w-18 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
      <span className={cn("block h-full rounded-sm", warning ? "bg-warning" : "bg-muted-foreground")} style={{ width: `${Math.round(fraction * 100)}%` }} />
    </span>
  );
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
