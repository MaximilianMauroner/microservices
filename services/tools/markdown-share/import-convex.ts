import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres, { type Sql } from "postgres";
import { applySteps, parseSnapshot, sourceSnapshot } from "./protocol.js";
import { applyMarkdownShareSchema } from "./schema.js";
import type { PublicDocument, EditorContent } from "./types.js";

type ExportRow = Record<string, unknown>;
export type ImportedDocument = PublicDocument & {
  source: string;
  version: number;
  checkpoints: { id: string; version: number; createdAt: number; createdBy: string; source: string }[];
};
function record(value: unknown): ExportRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid export record.");
  return value as ExportRow;
}
function text(row: ExportRow, key: string): string {
  if (typeof row[key] !== "string") throw new Error(`Invalid export field ${key}.`);
  return row[key];
}
function number(row: ExportRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid export field ${key}.`);
  return value;
}
async function table(directory: string, name: string): Promise<ExportRow[]> {
  const content = await readFile(resolve(directory, name, "documents.jsonl"), "utf8");
  return content.split("\n").filter(line => line.trim()).map(line => record(JSON.parse(line)));
}
function checkpointId(token: string, legacyId: string) {
  const hex = createHash("sha256").update(`${token}:${legacyId}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export async function readConvexExport(rootDirectory: string, syncDirectory: string, now = Date.now()): Promise<ImportedDocument[]> {
  const [documents, checkpoints, contents, snapshots, deltas] = await Promise.all([
    table(rootDirectory, "documents"), table(rootDirectory, "checkpoints"), table(rootDirectory, "checkpointContents"),
    table(syncDirectory, "snapshots"), table(syncDirectory, "deltas"),
  ]);
  const result: ImportedDocument[] = [];
  const tokens = new Set<string>();
  for (const row of documents) {
    if (number(row,"expiresAt") <= now) continue;
    const token = text(row,"token");
    if (!/^(?:[a-z0-9]{20,64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.test(token) || tokens.has(token)) throw new Error("Invalid or duplicate exported capability.");
    tokens.add(token);
    const latest = snapshots.filter(s => s.id === token).sort((a,b) => number(b,"version")-number(a,"version"))[0];
    if (!latest) throw new Error("Export lacks an editor snapshot. Include the prosemirrorSync component tables.");
    let content: EditorContent = parseSnapshot(text(latest,"content")).node.toJSON();
    let version = number(latest,"version");
    for (const delta of deltas.filter(d => d.id === token && number(d,"version") > version).sort((a,b) => number(a,"version")-number(b,"version"))) {
      if (!Array.isArray(delta.steps) || delta.steps.some(s => typeof s !== "string")) throw new Error("Invalid exported editor steps.");
      const end = number(delta,"version");
      const start = end-delta.steps.length;
      if (start > version) throw new Error("Exported editor history has a gap.");
      const steps = delta.steps.slice(Math.max(0,version-start)).map(s => JSON.parse(String(s)) as unknown);
      for (let offset=0;offset<steps.length;offset+=1000) content = applySteps(content,steps.slice(offset,offset+1000)).content;
      version = end;
    }
    const format = row.format ?? "markdown";
    const filename = text(row,"filename");
    if ((format !== "markdown" && format !== "latex") || filename.length > 80 || !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\.(?:md|tex)$/.test(filename) || !filename.endsWith(format === "latex" ? ".tex" : ".md")) throw new Error("Invalid exported document format or filename.");
    if (row.pinned !== undefined && typeof row.pinned !== "boolean") throw new Error("Invalid exported pin state.");
    const importedCheckpoints = checkpoints.filter(c => c.documentId === row._id).map(c => {
      const body = contents.find(body => body._id === c.contentId);
      if (!body) throw new Error("Exported checkpoint content is missing.");
      const source = text(body,"markdown");
      sourceSnapshot(source);
      const by = text(c,"createdBy");
      if (!by.trim() || by.length > 48) throw new Error("Invalid exported checkpoint author.");
      const checkpointVersion = c.version === undefined ? 0 : number(c,"version");
      if (checkpointVersion > version) throw new Error("Exported checkpoint is ahead of the document.");
      return { id: checkpointId(token,text(c,"_id")), version: checkpointVersion, createdAt: number(c,"createdAt"), createdBy: by, source };
    });
    if (importedCheckpoints.length > 20) throw new Error("Export has more than 20 checkpoints for one document.");
    result.push({ token, filename, format, pinned: row.pinned === true, createdAt: number(row,"createdAt"), updatedAt: number(row,"updatedAt"), expiresAt: number(row,"expiresAt"), source: parseSnapshot(JSON.stringify(content)).markdown, version, checkpoints: importedCheckpoints });
  }
  return result;
}

export function exportDigest(documents: ImportedDocument[]) {
  const normalized = documents.map(d => ({ token: d.token, filename: d.filename, format: d.format, pinned: d.pinned, createdAt: d.createdAt, updatedAt: d.updatedAt, expiresAt: d.expiresAt, source: d.source, version: d.version, checkpoints: [...d.checkpoints].sort((a,b) => a.id.localeCompare(b.id)).map(c => ({ id: c.id, version: c.version, createdAt: c.createdAt, createdBy: c.createdBy, source: c.source })) })).sort((a,b) => a.token.localeCompare(b.token));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export async function importDocuments(sql: Sql, documents: ImportedDocument[], ownerSubject: string): Promise<void> {
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('markdown-share-import'))`;
    for (const d of documents) {
      const content = sourceSnapshot(d.source);
      await tx`INSERT INTO tools.markdown_documents (token,request_id,request_hash,owner_subject,filename,format,created_at,updated_at,expires_at,pinned,version,history_floor,content,source)
        VALUES (${d.token},${`convex-import:${d.token}`},${exportDigest([d])},${ownerSubject},${d.filename},${d.format},${d.createdAt},${d.updatedAt},${d.expiresAt},${d.pinned},${d.version},${d.version},${tx.json(content as unknown as postgres.JSONValue)},${d.source})
        ON CONFLICT (token) DO NOTHING`;
      const [existing] = await tx`SELECT request_hash FROM tools.markdown_documents WHERE token=${d.token} FOR UPDATE`;
      if (existing.request_hash !== exportDigest([d])) throw new Error("An existing document differs from the export. Import stopped without overwriting it.");
      for (const c of d.checkpoints) await tx`INSERT INTO tools.markdown_checkpoints (id,token,version,created_at,created_by,source)
        VALUES (${c.id},${d.token},${c.version},${c.createdAt},${c.createdBy},${c.source}) ON CONFLICT (id) DO NOTHING`;
    }
    await verifyImportedDocuments(tx as unknown as Sql, documents);
  });
}

export async function verifyImportedDocuments(sql: Sql, documents: ImportedDocument[]) {
  const actual: ImportedDocument[] = [];
  for (const d of documents) {
    const [row] = await sql`SELECT * FROM tools.markdown_documents WHERE token=${d.token}`;
    if (!row) throw new Error("An imported document is missing.");
    const checkpoints = await sql`SELECT * FROM tools.markdown_checkpoints WHERE token=${d.token}`;
    actual.push({ token: String(row.token), filename: String(row.filename), format: row.format, pinned: row.pinned,
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), expiresAt: Number(row.expires_at), source: String(row.source), version: Number(row.version),
      checkpoints: checkpoints.map(c => ({ id: String(c.id), version: Number(c.version), createdAt: Number(c.created_at), createdBy: String(c.created_by), source: String(c.source) })) });
    if (parseSnapshot(JSON.stringify(row.content)).markdown !== row.source) throw new Error("An imported snapshot differs from its source.");
  }
  if (exportDigest(actual) !== exportDigest(documents)) throw new Error("Imported content or metadata differs from the export.");
}

async function main() {
  const [root, sync, operation = "check"] = process.argv.slice(2);
  if (!root || !sync || !["check","apply","verify"].includes(operation)) throw new Error("Usage: tsx markdown-share/import-convex.ts EXPORT_DIRECTORY SYNC_COMPONENT_DIRECTORY [check|apply|verify]");
  const asOf = process.env.DOCUMENT_SHARE_IMPORT_AS_OF;
  if (!asOf || !/^\d+$/.test(asOf) || !Number.isSafeInteger(Number(asOf))) throw new Error("DOCUMENT_SHARE_IMPORT_AS_OF must be the frozen export timestamp in milliseconds. Use the same value for check, apply, and verify.");
  const documents = await readConvexExport(root,sync,Number(asOf));
  if (operation !== "check") {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
    if (operation === "apply" && process.env.DOCUMENT_SHARE_IMPORT_CONFIRM !== "preserve-convex-documents") throw new Error("Import requires DOCUMENT_SHARE_IMPORT_CONFIRM=preserve-convex-documents and operator approval for production.");
    const admin = process.env.AUTH_ALLOWED_GOOGLE_SUBJECT;
    if (operation === "apply" && !admin) throw new Error("AUTH_ALLOWED_GOOGLE_SUBJECT is required. Imported documents belong to the admin.");
    const sql = postgres(process.env.DATABASE_URL, { max: 1 });
    try {
      if (operation === "apply" && admin) { await applyMarkdownShareSchema(sql, admin); await importDocuments(sql, documents, admin); }
      else await verifyImportedDocuments(sql,documents);
    } finally { await sql.end(); }
  }
  console.log(JSON.stringify({ operation, asOf: Number(asOf), documents: documents.length, checkpoints: documents.reduce((n,d)=>n+d.checkpoints.length,0), sha256: exportDigest(documents) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
