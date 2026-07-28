export const TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
  const match = pathname.match(/^\/d\/([^/]+)--([0-9a-f-]+)\/?$/i);
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

export function getAnonymousName(): string {
  const storageKey = "markdown-share:anonymous-name";
  const existing = sessionStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }

  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const value = random[0] ?? 0;
  const name = `${PRESENCE_NAMES[value % PRESENCE_NAMES.length]} ${String(value % 100).padStart(2, "0")}`;
  sessionStorage.setItem(storageKey, name);
  return name;
}
