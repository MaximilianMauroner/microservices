export const MAX_SOURCE_LENGTH = 500_000;
// Reserve space under Convex's 1 MiB value limit for snapshot/step JSON and metadata.
const MAX_ENCODED_SOURCE_BYTES = 900_000;

export function sourceSizeError(source: string): string | null {
  if (source.length > MAX_SOURCE_LENGTH) {
    return "Documents are limited to 500,000 characters. Shorten the text before pasting.";
  }
  // Source is inside serialized editor JSON, which is itself a Convex string.
  const encoded = JSON.stringify(JSON.stringify(source));
  if (new TextEncoder().encode(encoded).byteLength > MAX_ENCODED_SOURCE_BYTES) {
    return "This text exceeds the save size limit after encoding. Paste a smaller amount of text.";
  }
  return null;
}
