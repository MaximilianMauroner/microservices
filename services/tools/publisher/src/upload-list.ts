export const UPLOAD_CATEGORIES = [
  { id: "html", label: "HTML", mime: /^(text\/html|application\/xhtml\+xml)$/, extensions: /\.(html?|xhtml)$/i },
  { id: "pdf", label: "PDF", mime: /^application\/pdf$/, extensions: /\.pdf$/i },
  { id: "images", label: "Images", mime: /^image\//, extensions: /\.(png|jpe?g|gif|webp|svg|avif|heic|bmp|tiff?|ico)$/i },
  { id: "video", label: "Video", mime: /^video\//, extensions: /\.(mp4|webm|mov|m4v|avi|mkv|mpeg|mpg)$/i },
  { id: "audio", label: "Audio", mime: /^audio\//, extensions: /\.(mp3|wav|ogg|m4a|aac|flac|opus|aiff)$/i },
  { id: "archives", label: "Archives", mime: /^application\/(zip|gzip|x-gzip|x-tar|x-7z-compressed|x-rar-compressed|vnd\.rar|x-bzip2|x-xz)$/, extensions: /\.(zip|gz|tgz|tar|7z|rar|bz2|xz)$/i },
  { id: "documents", label: "Documents", mime: /^(text\/|application\/(msword|rtf|vnd\.(ms-|openxmlformats-officedocument\.|oasis\.opendocument\.)))/, extensions: /\.(txt|md|csv|rtf|docx?|xlsx?|pptx?|odt|ods|odp|tex)$/i },
  { id: "other", label: "Other", mime: /$^/, extensions: /$^/ }
] as const;

export type UploadCategory = typeof UPLOAD_CATEGORIES[number]["id"];
export type UploadListSort = "newest" | "oldest" | "filename" | "expiry" | "size";
export type UploadExpiryFilter = "all" | "24h" | "7d" | "persistent";
export type UploadListCriteria = {
  q: string;
  kind: "all" | "html" | "file";
  project: { mode: "all" } | { mode: "unassigned" } | { mode: "named"; name: string };
  expiry: UploadExpiryFilter;
  category: "all" | UploadCategory;
  sort: UploadListSort;
};

export const DEFAULT_UPLOAD_LIST_CRITERIA: UploadListCriteria = {
  q: "", kind: "all", project: { mode: "all" }, expiry: "all", category: "all", sort: "newest"
};

export function serializeUploadListCriteria(criteria: UploadListCriteria): string {
  return JSON.stringify({
    q: criteria.q.trim().normalize("NFKC").toLowerCase(),
    kind: criteria.kind,
    project: criteria.project.mode === "named" ? { mode: "named", name: criteria.project.name } : { mode: criteria.project.mode },
    expiry: criteria.expiry,
    category: criteria.category,
    sort: criteria.sort
  });
}

export function uploadListPath(criteria: UploadListCriteria, cursor?: string): string {
  const search = new URLSearchParams({ limit: "100", q: criteria.q, kind: criteria.kind,
    project: criteria.project.mode, expiry: criteria.expiry, category: criteria.category, sort: criteria.sort });
  if (criteria.project.mode === "named") search.set("projectName", criteria.project.name);
  if (cursor) search.set("cursor", cursor);
  else search.set("includeSummary", "true");
  return `/api/external-uploads?${search}`;
}

export function classifyUpload(contentType: string, filename: string): UploadCategory {
  const mime = contentType.split(";", 1)[0]!.trim().toLowerCase();
  const generic = !mime || mime === "application/octet-stream" || mime === "binary/octet-stream";
  return UPLOAD_CATEGORIES.find((category) => generic ? category.extensions.test(filename) : category.mime.test(mime))?.id ?? "other";
}
