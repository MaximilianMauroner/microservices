import { createApp } from "./app.js";
import { agentAuth } from "./auth.js";
import { loadConfig, type Config } from "./config.js";
import { createGracefulShutdown } from "./lifecycle.js";
import type { RepositoryHandle } from "./repository.js";

type ServerHandle = { stop: (force?: boolean) => void | Promise<void> };
type Serve = (options: {
  hostname: string;
  port: number;
  fetch: (request: Request) => Response | Promise<Response>;
}) => ServerHandle;

export async function startServer(
  dependencies: {
    config?: Config;
    createRepository?: (config: Config) => Promise<RepositoryHandle>;
    serve?: Serve;
    stylesheet?: BodyInit | Blob;
    log?: (message: string) => void;
  } = {},
) {
  const config = dependencies.config ?? loadConfig();
  const factory =
    dependencies.createRepository ??
    (async (value: Config) =>
      (await import("./repository.js")).createRepository(value));
  const handle = await factory(config);
  const log = dependencies.log ?? console.log;
  if (handle.startupReport) {
    log(JSON.stringify({ event: "postgres_import", ...handle.startupReport }));
  }
  let server: ServerHandle;
  try {
    const stylesheet =
      dependencies.stylesheet ??
      (typeof Bun !== "undefined"
        ? Bun.file(new URL("../public/review.css", import.meta.url))
        : "");
    const app = createApp({
      repository: handle.repository,
      agentAuth: agentAuth(config.agentApiToken),
      reviewerAuth: () => ({
        ok: false,
        response: new Response(
          JSON.stringify({ error: "unified_browser_required" }),
          {
            status: 503,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          },
        ),
      }),
      publicBaseUrl: config.publicBaseUrl,
      browserUi: false,
      stylesheet,
    });
    const serve: Serve = dependencies.serve ?? ((options) => Bun.serve(options));
    server = serve({ hostname: "0.0.0.0", port: config.port, fetch: app });
  } catch (error) {
    await handle.close();
    throw error;
  }
  log(`field-guide-console listening on port ${config.port}`);
  const shutdown = createGracefulShutdown({
    stop: (force) => server.stop(force),
    checkpoint: handle.checkpoint,
    close: handle.close,
    fail: () => {
      process.exitCode = 1;
    },
    report: (error) => console.error(error),
    terminate: () => process.exit(1),
  });
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  return { server, shutdown };
}

if (import.meta.main) await startServer();
