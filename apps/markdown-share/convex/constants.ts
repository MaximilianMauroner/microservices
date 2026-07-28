export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_MARKDOWN_LENGTH = 500_000;
export const MAX_FILENAME_LENGTH = 80;

export const LEGACY_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const FILENAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\.md$/;
