import { afterEach, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ postgres: vi.fn() }));
vi.mock("postgres", () => ({ default: boundary.postgres }));
import { createDocumentChanges } from "./changes";

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it("retries LISTEN after startup failure while requests keep arriving", async () => {
  vi.useFakeTimers();
  let reject!: (error: Error) => void;
  const failed = { listen: vi.fn(() => new Promise<void>((_, fail) => { reject = fail; })), end: vi.fn(async () => {}) };
  const recovered = { listen: vi.fn(async () => {}), end: vi.fn(async () => {}) };
  boundary.postgres.mockReturnValueOnce(failed).mockReturnValue(recovered);
  const changes = createDocumentChanges("owned-test-database");
  const first = changes.subscribe("one");
  const concurrent = changes.subscribe("two");
  const rejection = expect(first.ready).rejects.toThrow("startup failed");
  reject(new Error("startup failed"));
  await rejection;
  await Promise.all([first.promise, concurrent.promise]);
  const retry = changes.subscribe("three");
  await retry.ready;
  expect(recovered.listen).toHaveBeenCalledOnce();
  expect(boundary.postgres).toHaveBeenCalledTimes(2);
  await changes.close();
  await retry.promise;
  expect(failed.end).toHaveBeenCalledOnce();
  expect(recovered.end).toHaveBeenCalledOnce();
});
