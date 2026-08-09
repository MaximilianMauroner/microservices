const DEFAULT_CONTENT_TYPE = "application/octet-stream";
const MAX_FILE_NAME_BYTES = 240;
export const MAX_PROJECT_NAME_BYTES = 240;
const MIME_TYPE_PATTERN =
  /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function normalizeMimeType(mimeType: string) {
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return MIME_TYPE_PATTERN.test(normalized) ? normalized : DEFAULT_CONTENT_TYPE;
}

export function safeFileName(originalName: string, fallback: string) {
  const portableName = originalName.replace(/\\/g, "/").split("/").pop() ?? "";
  const sanitized = portableName.replace(/[\u0000-\u001F\u007F"]/g, "_");
  const bounded = truncateUtf8(sanitized, MAX_FILE_NAME_BYTES);

  if (!bounded || bounded === "." || bounded === "..") {
    return fallback;
  }

  return bounded;
}

export function attachmentDisposition(originalName: string) {
  const safeName = safeFileName(originalName, "download.bin");
  const fallbackName = safeName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");

  if (/^[\x20-\x7E]+$/.test(safeName)) {
    return `attachment; filename="${fallbackName}"`;
  }

  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeRfc5987(safeName)}`;
}

export function originalNameMetadata(originalName: string) {
  const safeName = safeFileName(originalName, "download.bin");

  return {
    "original-name": safeName.replace(/[^\x20-\x7E]/g, "_"),
    "original-name-base64": Buffer.from(safeName, "utf8").toString("base64")
  };
}

export function normalizeProjectName(project: string) {
  const normalized = project.normalize("NFKC").trim();
  if (
    !normalized ||
    Buffer.byteLength(normalized, "utf8") > MAX_PROJECT_NAME_BYTES ||
    /[\u0000-\u001F\u007F]/.test(normalized)
  ) {
    return undefined;
  }

  return normalized;
}

export function projectMetadata(project: string | undefined): Record<string, string> {
  const normalized = project ? normalizeProjectName(project) : undefined;
  return normalized
    ? { "project-base64": Buffer.from(normalized, "utf8").toString("base64") }
    : {};
}

export function readProjectMetadata(metadata: Record<string, string | undefined>) {
  const encodedProject = metadata["project-base64"];
  if (!encodedProject || !isCanonicalBase64(encodedProject)) {
    return undefined;
  }

  return normalizeProjectName(Buffer.from(encodedProject, "base64").toString("utf8"));
}

export function readOriginalNameMetadata(
  metadata: Record<string, string | undefined>,
  fallback: string
) {
  const encodedName = metadata["original-name-base64"];
  if (encodedName && isCanonicalBase64(encodedName)) {
    const decodedName = Buffer.from(encodedName, "base64").toString("utf8");
    return safeFileName(decodedName, fallback);
  }

  return safeFileName(metadata["original-name"] ?? "", fallback);
}

function truncateUtf8(value: string, maxBytes: number) {
  let bytes = 0;
  let result = "";

  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) {
      break;
    }

    result += character;
    bytes += characterBytes;
  }

  return result;
}

function encodeRfc5987(value: string) {
  const validUtf8 = Buffer.from(value, "utf8").toString("utf8");
  return encodeURIComponent(validUtf8).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function isCanonicalBase64(value: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }

  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value && Buffer.from(decoded.toString("utf8")).equals(decoded);
}
