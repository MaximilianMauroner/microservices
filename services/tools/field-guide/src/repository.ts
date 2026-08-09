import type { Config } from "./config.js";
import { PostgresReviewRepository } from "./postgres-repository.js";
import type { ReviewRepository } from "./types.js";

export type RepositoryHandle = { repository: ReviewRepository; close: () => Promise<void> };

export async function createRepository(
  config: Config,
  options: { readOnly?: boolean } = {},
): Promise<RepositoryHandle> {
  const repository = new PostgresReviewRepository(config.databaseUrl, options);
  return { repository, close: () => repository.close() };
}
