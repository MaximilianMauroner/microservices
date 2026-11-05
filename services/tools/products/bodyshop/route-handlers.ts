import type { PlatformRouteInput } from "../../platform/route-handlers.js";
import { BodyshopError } from "./domain.js";
import { commitImport, previewImport } from "./service.js";
import { readBoundedBody, RequestBodyTooLargeError } from "../../platform/request-body.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Reads the workbook and returns what an import would write. Nothing is stored. */
export async function previewBodyshopImport(input: PlatformRouteInput) {
  return handle(input, async (form) => {
    if ([...form.keys()].some((key) => key !== "file")) throw new BodyshopError("Send only the workbook.");
    const file = singleFile(form);
    return json(await previewImport(scope(input), new Uint8Array(await file.arrayBuffer()), file.name));
  });
}

/** Imports the workbook the preview showed. The same file again returns the first receipt. */
export async function commitBodyshopImport(input: PlatformRouteInput) {
  return handle(input, async (form) => {
    const file = singleFile(form);
    const digest = form.getAll("expectedDigest");
    const mark = form.getAll("expectedChangeMark");
    if (digest.length !== 1 || typeof digest[0] !== "string" || mark.length !== 1 || typeof mark[0] !== "string") throw new BodyshopError("Check the file before you import it.");
    const result = await commitImport(scope(input), new Uint8Array(await file.arrayBuffer()), file.name, { digest: digest[0], changeMark: mark[0] });
    return json(result, result.replay ? 200 : 201);
  });
}

function scope(input: PlatformRouteInput) {
  return input.context.runtime.bodyshop.owner(input.context.principal!.subject);
}

async function handle(input: PlatformRouteInput, run: (form: FormData) => Promise<Response>) {
  const { request, context } = input;
  if (!context.principal) return json({ error: "authentication_required" }, 401);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(context.runtime.publicOrigin).origin) return json({ error: "invalid_origin" }, 403);
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_FILE_BYTES + 64 * 1024)) {
    return json({ error: "file_too_large", message: "The workbook must be 10 MB or smaller." }, 413);
  }
  try {
    return await run(await multipart(request));
  } catch (error) {
    if (error instanceof BodyshopError) {
      return json({ error: error.code, message: error.message }, error.code === "conflict" ? 409 : error.code === "not_found" ? 404 : error.code === "too_large" ? 413 : 400);
    }
    console.error(JSON.stringify({ event: "bodyshop.import_failed", errorType: error instanceof Error ? error.name : "UnknownError" }));
    return json({ error: "import_failed", message: "The workbook could not be imported." }, 500);
  }
}

async function multipart(request: Request): Promise<FormData> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) throw new BodyshopError("Send the workbook as a file upload.");
  const bytes = await boundedBody(request, MAX_FILE_BYTES + 64 * 1024);
  try {
    return await new Request(request.url, { method: "POST", headers: request.headers, body: bytes }).formData();
  } catch {
    throw new BodyshopError("The upload could not be read.");
  }
}

async function boundedBody(request: Request, maximumBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const bytes = await readBoundedBody(request, maximumBytes);
    if (!bytes) throw new BodyshopError("The upload is empty.");
    return bytes;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw new BodyshopError("The workbook must be 10 MB or smaller.", "too_large");
    throw error;
  }
}

function singleFile(form: FormData): File {
  const files = form.getAll("file");
  const [file] = files;
  if (files.length !== 1 || !(file instanceof File)) throw new BodyshopError("Choose one xlsx workbook.");
  if (file.size > MAX_FILE_BYTES) throw new BodyshopError("The workbook must be 10 MB or smaller.", "too_large");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new BodyshopError("Choose an .xlsx file. Download the sheet as Microsoft Excel (.xlsx) first.");
  return file;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" } });
}
