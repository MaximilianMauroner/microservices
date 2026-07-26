import { createApp } from "./app.js";
import express from "express";
import { agentAuth, shooAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { PostgresReviewRepository } from "./postgres-repository.js";
import { reviewConsole } from "./ui.js";
const config = loadConfig(),
  repository = new PostgresReviewRepository(config.databaseUrl);
await repository.migrate();
const reviewer = shooAuth({
  allowedEmail: config.allowedEmail,
  audience: `origin:${config.publicBaseUrl}`,
});
const core = createApp({
  repository,
  agentAuth: agentAuth(config.agentApiToken),
  reviewerAuth: reviewer,
});
const app = express();
app.get(["/review", "/review/callback"], reviewConsole);
app.get("/api/review/history", reviewer, async (req, res) => {
  const scope = req.query.scope;
  const page = await repository.decisions(undefined, 100);
  res.json({
    decisions: page.decisions.filter((d) => !scope || d.scope === scope),
    summary: await repository.summary(new Date()),
  });
});
app.use(core);
const server = app.listen(config.port, "0.0.0.0", () =>
  console.log(`field-guide-review listening on port ${config.port}`),
);
let closing = false;
const shutdown = (signal: string) => {
  if (closing) return;
  closing = true;
  const timer = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 10_000);
  timer.unref();
  server.close(
    (error) =>
      void repository.close().finally(() => {
        clearTimeout(timer);
        if (error) process.exitCode = 1;
      }),
  );
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
