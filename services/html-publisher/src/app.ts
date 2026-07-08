import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { UploadStorage } from "./storage.js";

export const MAX_SINGLE_PUT_UPLOAD_BYTES = 5_000_000_000;
export const DEFAULT_MAX_UPLOAD_BYTES = MAX_SINGLE_PUT_UPLOAD_BYTES;
export const DEFAULT_TEMPORARY_FILE_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const PAGE_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const HTML_MIME_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const PUBLIC_HTML_CSP =
  "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads";

export type CreateAppOptions = {
  storage: UploadStorage;
  uploadToken: string;
  publicBaseUrl?: string;
  maxUploadBytes?: number;
  temporaryFileRetentionMs?: number;
  now?: () => Date;
};

export function createApp(options: CreateAppOptions) {
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const upload = multer({
    storage: multer.diskStorage({
      destination: os.tmpdir(),
      filename: (_req, _file, callback) => {
        callback(null, `html-publisher-${crypto.randomBytes(16).toString("hex")}`);
      }
    }),
    limits: {
      files: 1,
      fileSize: maxUploadBytes
    }
  }).single("file");

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.post("/api/uploads", requireUploadToken(options.uploadToken), (req, res, next) => {
    upload(req, res, (error) => {
      if (error) {
        next(error);
        return;
      }

      void handleUpload(req, res, next, options);
    });
  });

  app.get("/p/:id", async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!PAGE_ID_PATTERN.test(id)) {
        res.sendStatus(404);
        return;
      }

      const html = await options.storage.getHtml(id);
      if (!html) {
        res.sendStatus(404);
        return;
      }

      applySandboxHeaders(res);
      res.type("html").send(html.body);
    } catch (error) {
      next(error);
    }
  });

  app.get("/f/:id/:filename", async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!PAGE_ID_PATTERN.test(id)) {
        res.sendStatus(404);
        return;
      }

      const file = await options.storage.getTemporaryFile(id);
      if (!file || file.expiresAt <= getNow(options)) {
        file?.body.destroy();
        res.sendStatus(404);
        return;
      }

      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Disposition", attachmentDisposition(file.originalName));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      file.body.on("error", next);
      file.body.pipe(res);
    } catch (error) {
      next(error);
    }
  });

  app.use(errorHandler);

  return app;
}

async function handleUpload(
  req: Request,
  res: Response,
  next: NextFunction,
  options: CreateAppOptions
) {
  let file: Express.Multer.File | undefined;
  try {
    file = req.file;
    if (!file) {
      res.status(400).json({ error: "missing_file", message: "Expected multipart field `file`." });
      return;
    }

    const uploadType = classifyUpload(file);
    const id = generatePageId();
    const originalName = safeFileName(file.originalname, uploadType.kind === "temporary" ? "download" : "page.html");
    const sha256 = await sha256File(file.path);
    const baseUrl = getPublicBaseUrl(req, options.publicBaseUrl);

    if (uploadType.kind === "html") {
      await options.storage.putHtml(id, file.path, {
        bytes: file.size,
        originalName,
        sha256
      });

      res.status(201).json({
        id,
        url: `${baseUrl}/p/${id}`,
        bytes: file.size,
        sha256
      });
      return;
    }

    const expiresAt = new Date(getNow(options).getTime() + getTemporaryFileRetentionMs(options));
    await options.storage.putTemporaryFile(id, file.path, {
      bytes: file.size,
      contentType: uploadType.contentType,
      expiresAt,
      originalName,
      sha256
    });

    res.status(201).json({
      id,
      url: `${baseUrl}/f/${id}/${encodeURIComponent(originalName)}`,
      bytes: file.size,
      expiresAt: expiresAt.toISOString(),
      sha256
    });
  } catch (error) {
    next(error);
  } finally {
    if (file?.path) {
      await safeUnlink(file.path);
    }
  }
}

function requireUploadToken(uploadToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authorization = req.get("authorization");
    const expected = `Bearer ${uploadToken}`;

    if (!authorization || !constantTimeEquals(authorization, expected)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    next();
  };
}

function constantTimeEquals(actual: string, expected: string) {
  const actualHash = crypto.createHash("sha256").update(actual).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

type UploadClassification =
  | {
      kind: "html";
    }
  | {
      contentType: string;
      kind: "temporary";
    };

function classifyUpload(file: Express.Multer.File): UploadClassification {
  const extension = path.extname(file.originalname).toLowerCase();
  const mimeType = normalizeMimeType(file.mimetype);

  if (HTML_EXTENSIONS.has(extension) && HTML_MIME_TYPES.has(mimeType)) {
    return { kind: "html" };
  }

  return {
    contentType: mimeType,
    kind: "temporary"
  };
}

function generatePageId() {
  return crypto.randomBytes(24).toString("base64url");
}

function getPublicBaseUrl(req: Request, configuredBaseUrl?: string) {
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  return `${req.protocol}://${req.get("host")}`;
}

function applySandboxHeaders(res: Response) {
  res.setHeader("Content-Security-Policy", PUBLIC_HTML_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

async function sha256File(filePath: string) {
  const hash = crypto.createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function safeUnlink(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    const candidate = error as { code?: string };
    if (candidate.code !== "ENOENT") {
      console.error(error);
    }
  }
}

function getTemporaryFileRetentionMs(options: CreateAppOptions) {
  return options.temporaryFileRetentionMs ?? DEFAULT_TEMPORARY_FILE_RETENTION_MS;
}

function getNow(options: CreateAppOptions) {
  return options.now?.() ?? new Date();
}

function normalizeMimeType(mimeType: string) {
  return mimeType.toLowerCase() || "application/octet-stream";
}

function safeFileName(originalName: string, fallback: string) {
  const baseName = path.basename(originalName).replace(/[\0\r\n"]/g, "_");
  return baseName || fallback;
}

function attachmentDisposition(originalName: string) {
  const fallbackName = safeFileName(originalName, "download.bin")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");
  return `attachment; filename="${fallbackName}"`;
}

function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "payload_too_large" });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "internal_server_error" });
}
