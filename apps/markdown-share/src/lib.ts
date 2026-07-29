import { diffLines } from "diff";

export const TOKEN_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9]{20,64})$/;

export type DocumentRoute = {
  filename: string;
  token: string;
};

export function normalizeFilename(input: string): string {
  const withoutExtension = input.trim().replace(/\.md$/i, "");
  const slug = withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");

  return `${slug || "untitled"}.md`;
}

export function documentPath(filename: string, token: string): string {
  return `/d/${encodeURIComponent(filename)}--${token}`;
}

export function parseDocumentRoute(pathname: string): DocumentRoute | null {
  const match = pathname.match(/^\/d\/([^/]+)--([a-z0-9-]+)\/?$/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  const token = match[2].toLowerCase();
  if (!TOKEN_PATTERN.test(token)) {
    return null;
  }

  try {
    return { filename: decodeURIComponent(match[1]), token };
  } catch {
    return null;
  }
}

export function initialMarkdown(filename: string): string {
  const title = filename.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
  return `# ${title}\n\nStart writing together. Your document disappears seven days after the latest edit.`;
}

export function markdownFromJson(content: unknown): string {
  if (
    typeof content !== "object" ||
    content === null ||
    !("content" in content) ||
    !Array.isArray(content.content)
  ) {
    return "";
  }
  const firstNode: unknown = content.content[0];
  if (
    typeof firstNode !== "object" ||
    firstNode === null ||
    !("content" in firstNode) ||
    !Array.isArray(firstNode.content)
  ) {
    return "";
  }

  return firstNode.content
    .map((node: unknown) => {
      if (
        typeof node === "object" &&
        node !== null &&
        "text" in node &&
        typeof node.text === "string"
      ) {
        return node.text;
      }
      return "";
    })
    .join("");
}

export function formatExpiry(expiresAt: number, now = Date.now()): string {
  const remaining = Math.max(0, expiresAt - now);
  const totalMinutes = Math.ceil(remaining / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatViewerCount(count: number): string {
  const viewers = Math.max(1, Math.floor(count));
  return `${viewers} viewing`;
}

export function getScrollProgress(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const scrollableHeight = Math.max(0, scrollHeight - clientHeight);
  if (scrollableHeight === 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, scrollTop / scrollableHeight));
}

export function getScrollTop(
  progress: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const scrollableHeight = Math.max(0, scrollHeight - clientHeight);
  return Math.min(1, Math.max(0, progress)) * scrollableHeight;
}

export type DiffRow = {
  kind: "added" | "removed" | "unchanged";
  value: string;
  oldLine: number | null;
  newLine: number | null;
};

export function buildDiffRows(older: string, newer: string): DiffRow[] {
  let oldLine = 1;
  let newLine = 1;

  return diffLines(older, newer).flatMap((part) => {
    const lines = part.value.split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }

    return lines.map((value) => {
      const kind = part.added
        ? "added"
        : part.removed
          ? "removed"
          : "unchanged";
      const row: DiffRow = {
        kind,
        value,
        oldLine: kind === "added" ? null : oldLine,
        newLine: kind === "removed" ? null : newLine,
      };
      if (kind !== "added") {
        oldLine += 1;
      }
      if (kind !== "removed") {
        newLine += 1;
      }
      return row;
    });
  });
}

const PRESENCE_NAMES = [
  "Amber Fox",
  "Blue Finch",
  "Cedar Otter",
  "Indigo Moth",
  "Mint Badger",
  "Ochre Wren",
  "Silver Hare",
  "Violet Lynx",
] as const;

export type PresenceIdentity = {
  userId: string;
  displayName: string;
};

export function getPresenceIdentity(): PresenceIdentity {
  const userIdKey = "markdown-share:presence-user-id";
  const nameKey = "markdown-share:anonymous-name";
  let userId = sessionStorage.getItem(userIdKey);
  if (!userId) {
    userId = crypto.randomUUID();
    sessionStorage.setItem(userIdKey, userId);
  }

  const existingName = sessionStorage.getItem(nameKey);
  if (existingName) {
    return { userId, displayName: existingName };
  }

  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const value = random[0] ?? 0;
  const displayName = `${PRESENCE_NAMES[value % PRESENCE_NAMES.length]} ${String(value % 100).padStart(2, "0")}`;
  sessionStorage.setItem(nameKey, displayName);
  return { userId, displayName };
}
