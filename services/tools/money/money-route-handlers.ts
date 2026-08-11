import type { PlatformRouteInput } from "../src/route-handlers.js";
import { MoneyImportValidationError } from "./money-import-domain.js";
import { assertMoneyImportFileSize } from "./money-import-service.js";

export async function previewMoneyImport(input: PlatformRouteInput) {
  const rejected = validateMutationRequest(input);
  if (rejected) return rejected;
  try {
    const file = await moneyFile(input.request);
    const preview = await input.context.runtime.moneyImports.preview(file.name, await fileBytes(file));
    return json(preview);
  } catch (error) {
    return importError(error);
  }
}

export async function commitMoneyImport(input: PlatformRouteInput) {
  const rejected = validateMutationRequest(input);
  if (rejected) return rejected;
  try {
    const form = await multipart(input.request);
    const file = singleFile(form);
    const digest = singleString(form, "expectedDigest");
    assertMoneyImportFileSize(file.size);
    const receipt = await input.context.runtime.moneyImports.commit({
      filename: file.name,
      bytes: await fileBytes(file),
      expectedDigest: digest,
      actor: input.context.principal!.email
    });
    return json(receipt, receipt.replay ? 200 : 201);
  } catch (error) {
    return importError(error);
  }
}

export async function deleteMoneyImport(input: PlatformRouteInput) {
  const rejected = validateMutationRequest(input);
  if (rejected) return rejected;
  try {
    const deleted = await input.context.runtime.moneyImports.deleteImport(input.params.importId ?? "");
    return json({ ok: true, ...deleted });
  } catch (error) {
    return importError(error);
  }
}

export async function reimportAllMoneyImports(input: PlatformRouteInput) {
  const rejected = validateMutationRequest(input);
  if (rejected) return rejected;
  try {
    return json({ ok: true, ...await input.context.runtime.moneyImports.reimportAll() });
  } catch (error) {
    return importError(error);
  }
}

export async function updateMoneyCategory(input: PlatformRouteInput) {
  const rejected = validateMutationRequest(input);
  if (rejected) return rejected;
  try {
    const body = await jsonBody(input.request);
    const result = await input.context.runtime.moneyImports.setTransactionCategory({
      transactionId: stringField(body, "transactionId"),
      category: stringField(body, "category"),
      createRule: body.createRule === true,
      actor: input.context.principal!.email
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return importError(error);
  }
}

export async function deleteMoneyCategoryRule(input: PlatformRouteInput) {
  const rejected = validateMutationRequest(input);
  if (rejected) return rejected;
  try {
    const body = await jsonBody(input.request);
    const result = await input.context.runtime.moneyImports.deleteCategoryRule(stringField(body, "ruleId"));
    return json({ ok: true, ...result });
  } catch (error) {
    return importError(error);
  }
}

export async function updateMoneyTransfer(input: PlatformRouteInput) {
  const rejected = validateMutationRequest(input);
  if (rejected) return rejected;
  try {
    const body = await jsonBody(input.request);
    const payload = {
      transactionId: stringField(body, "transactionId"),
      disposition: stringField(body, "disposition")
    };
    if (body.group === true) {
      const result = await input.context.runtime.moneyImports.setTransferGroupDisposition(payload);
      return json({ ok: true, ...result });
    }
    await input.context.runtime.moneyImports.setTransferDisposition(payload);
    return json({ ok: true, affectedCount: 1 });
  } catch (error) {
    return importError(error);
  }
}

export async function addMoneyBalance(input: PlatformRouteInput) {
  const rejected = validateMutationRequest(input);
  if (rejected) return rejected;
  try {
    const body = await jsonBody(input.request);
    await input.context.runtime.moneyImports.addManualBalance({
      ...(optionalStringField(body, "accountId") ? { accountId: optionalStringField(body, "accountId") } : { accountName: optionalStringField(body, "accountName") }),
      date: stringField(body, "date"), value: stringField(body, "value"), currency: stringField(body, "currency")
    });
    return json({ ok: true }, 201);
  } catch (error) {
    return importError(error);
  }
}

export async function getMoneyActivity(input: PlatformRouteInput) {
  if (!input.context.principal) return json({ error: "authentication_required" }, 401);
  try {
    const url = new URL(input.request.url);
    return json(await input.context.runtime.moneyImports.readActivityPage({
      query: url.searchParams.get("query") ?? "",
      ...(url.searchParams.get("flow") ? { flow: url.searchParams.get("flow")! } : {}),
      reviewOnly: url.searchParams.get("review") === "true",
      offset: integerParameter(url.searchParams.get("offset"), 0),
      limit: integerParameter(url.searchParams.get("limit"), 200)
    }));
  } catch (error) {
    return importError(error);
  }
}

export async function getMoneyMarketData(input: PlatformRouteInput) {
  if (!input.context.principal) return json({ error: "authentication_required" }, 401);
  try {
    return json(await input.context.runtime.moneyMarketData.snapshot());
  } catch (error) {
    return marketDataError(error);
  }
}

export async function syncMoneyMarketData(input: PlatformRouteInput) {
  const rejected = validateMutationRequest(input);
  if (rejected) return rejected;
  try {
    return json(await input.context.runtime.moneyMarketData.sync());
  } catch (error) {
    return marketDataError(error);
  }
}

function validateMutationRequest({ request, context }: PlatformRouteInput) {
  if (!context.principal) return json({ error: "authentication_required" }, 401);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(context.runtime.publicOrigin).origin) {
    return json({ error: "invalid_origin" }, 403);
  }
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null && !/^\d+$/.test(contentLengthHeader)) {
    return json({ error: "invalid_content_length", message: "The request Content-Length is invalid." }, 400);
  }
  const contentLength = contentLengthHeader === null ? undefined : Number(contentLengthHeader);
  if (contentLength !== undefined && contentLength > 11 * 1024 * 1024) {
    return json({ error: "file_too_large", message: "Money imports must be 10 MB or smaller." }, 413);
  }
  return undefined;
}

async function moneyFile(request: Request) {
  const form = await multipart(request);
  const file = singleFile(form);
  if ([...form.keys()].some((key) => key !== "file")) {
    throw new MoneyImportValidationError("invalid_form", "Preview accepts only one file.");
  }
  assertMoneyImportFileSize(file.size);
  return file;
}

async function multipart(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new MoneyImportValidationError("invalid_content_type", "Expected a multipart file upload.");
  }
  try {
    const bytes = await boundedBody(request, 11 * 1024 * 1024);
    return await new Request(request.url, { method: "POST", headers: request.headers, body: bytes }).formData();
  } catch (error) {
    if (error instanceof MoneyImportValidationError) throw error;
    throw new MoneyImportValidationError("invalid_form", "The multipart upload could not be parsed.");
  }
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new MoneyImportValidationError("invalid_content_type", "Expected a JSON request.");
  }
  try {
    const bytes = await boundedBody(request, 16_384);
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof MoneyImportValidationError) throw error;
    throw new MoneyImportValidationError("invalid_json", "The JSON request could not be parsed.");
  }
}

async function boundedBody(request: Request, maximumBytes: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new MoneyImportValidationError("invalid_request", "The request body is missing.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new MoneyImportValidationError("request_too_large", "The request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function stringField(body: Record<string, unknown>, name: string) {
  const value = body[name];
  if (typeof value !== "string") throw new MoneyImportValidationError("invalid_request", `Expected ${name} to be a string.`);
  return value;
}

function optionalStringField(body: Record<string, unknown>, name: string) {
  const value = body[name];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new MoneyImportValidationError("invalid_request", `Expected ${name} to be a string.`);
  return value;
}

function integerParameter(value: string | null, fallback: number) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new MoneyImportValidationError("invalid_parameter", "Expected an integer query parameter.");
  return Number(value);
}

function singleFile(form: FormData) {
  const values = form.getAll("file");
  if (values.length !== 1 || !(values[0] instanceof File)) {
    throw new MoneyImportValidationError("invalid_file", "Expected exactly one file.");
  }
  return values[0];
}

function singleString(form: FormData, name: string) {
  const values = form.getAll(name);
  if (values.length !== 1 || typeof values[0] !== "string" || !values[0]) {
    throw new MoneyImportValidationError("invalid_form", `Expected one ${name} field.`);
  }
  return values[0];
}

async function fileBytes(file: File) {
  return new Uint8Array(await file.arrayBuffer());
}

function importError(error: unknown) {
  if (error instanceof MoneyImportValidationError) {
    const status = error.code === "file_too_large" || error.code === "request_too_large" ? 413
      : error.code === "import_not_found" || error.code === "category_rule_not_found" ? 404 : 400;
    return json({ error: error.code, message: error.message }, status);
  }
  console.error(JSON.stringify({
    event: "money.import_failed",
    errorType: error instanceof Error ? error.name : "UnknownError"
  }));
  return json({ error: "import_failed", message: "The statement could not be imported." }, 500);
}

function marketDataError(error: unknown) {
  console.error(JSON.stringify({
    event: "money.market_data_failed",
    errorType: error instanceof Error ? error.name : "UnknownError"
  }));
  return json({ error: "market_data_unavailable", message: "Market data is temporarily unavailable." }, 503);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
