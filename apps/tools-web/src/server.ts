import { createApp } from "./app.js";
import { createAccessVerifier } from "./auth.js";
import { createS3JsonBucket } from "./bucket.js";
import { loadConfig } from "./config.js";
import { WebStorage } from "./storage.js";

const config = loadConfig();
const storage = new WebStorage(createS3JsonBucket(config.bucket));
const access = createAccessVerifier(config.access);
const fetch = createApp({
  storage,
  access,
  trustedOrigin: config.trustedOrigin
});

Bun.serve({
  port: config.port,
  fetch
});

console.info(JSON.stringify({ event: "server.started", port: config.port }));
