import { createApp } from "./app.js";
import { agentAuth, shooAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { createGracefulShutdown } from "./lifecycle.js";
import { PostgresReviewRepository } from "./postgres-repository.js";

const config = loadConfig();
const repository = new PostgresReviewRepository(config.databaseUrl);
const app = createApp({
  repository,
  agentAuth: agentAuth(config.agentApiToken),
  reviewerAuth: shooAuth({
    allowedEmail: config.allowedEmail,
    audience: `origin:${config.publicBaseUrl}`,
  }),
  publicBaseUrl: config.publicBaseUrl,
  stylesheet: Bun.file(new URL("../public/review.css", import.meta.url)),
});
const server = Bun.serve({
  hostname: "0.0.0.0",
  port: config.port,
  fetch: app,
});
console.log(`field-guide-review listening on port ${config.port}`);

const shutdown = createGracefulShutdown({
  stop: (force) => server.stop(force),
  close: () => repository.close(),
  fail: () => {
    process.exitCode = 1;
  },
  report: (error) => console.error(error),
});
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
