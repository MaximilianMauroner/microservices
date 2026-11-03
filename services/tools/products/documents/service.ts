import { randomUUID } from "node:crypto";
import { createPostgresScheduledTaskLeaseRepository } from "../../platform/scheduler/leases.js";
import { startAlignedScheduler } from "../../platform/scheduler/scheduler.js";
import { createMarkdownShareRepository } from "./repository.js";
import { createDocumentChanges } from "./changes.js";
import { createShareHandler } from "./http.js";

export function createDocumentShare(databaseUrl: string, publicOrigin: string, readOnly: boolean, creator: (request: Request) => Promise<string>) {
  const repository = createMarkdownShareRepository(databaseUrl);
  const changes = createDocumentChanges(databaseUrl);
  const cleanup = readOnly ? undefined : startAlignedScheduler({
    intervalMs: 3_600_000,
    lease: { repository: createPostgresScheduledTaskLeaseRepository(databaseUrl), taskId: "document-share:expiry", ownerId: randomUUID(), durationMs: 5 * 60_000 },
    run: async () => {
      let deleted = 0;
      for (let batch = 0; batch < 10; batch++) {
        const count = await repository.expire(200);
        deleted += count;
        if (count < 200) break;
      }
      if (deleted > 0) console.info(JSON.stringify({ event: "document_share.expired", deleted }));
    },
    logger: {
      info: (event, fields = {}) => console.info(JSON.stringify({ event, task: "document-share", ...fields })),
      error: (event, fields = {}) => console.error(JSON.stringify({ event, task: "document-share", ...fields })),
    },
  });
  return {
    handle: createShareHandler(repository, changes, publicOrigin, creator),
    owner: repository.owner,
    readiness: repository.readiness,
    async close() {
      await cleanup?.close();
      await changes.close();
      await repository.close();
    },
  };
}
