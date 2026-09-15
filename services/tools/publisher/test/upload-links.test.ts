import { beforeEach, describe, expect, it, vi } from "vitest";

const { postgresMock, sqlMock } = vi.hoisted(() => ({
  postgresMock: vi.fn(),
  sqlMock: vi.fn()
}));

vi.mock("postgres", () => ({ default: postgresMock }));

import { createPostgresUploadLinkRepository } from "../src/upload-links.js";

describe("Postgres upload links", () => {
  beforeEach(() => {
    postgresMock.mockReset();
    sqlMock.mockReset();
    Object.assign(sqlMock, { end: vi.fn(async () => {}) });
    postgresMock.mockReturnValue(sqlMock);
  });

  it("recovers an ambiguous committed insert without creating another link", async () => {
    const persisted = new Map<string, { tokenHash: string; createdAt: Date }>();
    const expiresAt = new Date(Date.now() + 86_400_000);
    sqlMock.mockImplementation(async (
      _strings: TemplateStringsArray,
      id: string,
      tokenHash: string,
      createdAt: Date
    ) => {
      const existing = persisted.get(id);
      if (!existing) {
        persisted.set(id, { tokenHash, createdAt });
        throw Object.assign(new Error("connection closed after commit"), { code: "CONNECTION_CLOSED" });
      }
      expect({ tokenHash, createdAt }).toEqual(existing);
      return [{
        id,
        created_at: existing.createdAt,
        expires_at: expiresAt,
        revoked_at: null
      }];
    });

    const repository = createPostgresUploadLinkRepository("postgresql://database.example.test/tools");
    const created = await repository.create(expiresAt);

    expect(persisted.size).toBe(1);
    expect(created.id).toBe(sqlMock.mock.calls[0]![1]);
    expect(created.token).toHaveLength(43);
    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(sqlMock.mock.calls[1]!.slice(1)).toEqual(sqlMock.mock.calls[0]!.slice(1));
    expect((sqlMock.mock.calls[0]![0] as TemplateStringsArray).join(" ")).toContain(
      "on conflict (id) do update"
    );
  });

  it("retries while PostgreSQL is still starting", async () => {
    const unavailable = Object.assign(new Error("database system is starting up"), { code: "57P03" });
    const expiresAt = new Date(Date.now() + 86_400_000);
    sqlMock
      .mockRejectedValueOnce(unavailable)
      .mockImplementationOnce(async (_strings: TemplateStringsArray, id: string, _tokenHash: string, createdAt: Date) => [{
        id,
        created_at: createdAt,
        expires_at: expiresAt,
        revoked_at: null
      }]);
    const repository = createPostgresUploadLinkRepository("postgresql://database.example.test/tools");

    await expect(repository.create(expiresAt)).resolves.toMatchObject({ expiresAt });
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it("stops retrying when the creation request is aborted", async () => {
    const controller = new AbortController();
    const aborted = new DOMException("The request was aborted.", "AbortError");
    sqlMock.mockImplementationOnce(async () => {
      controller.abort(aborted);
      throw Object.assign(new Error("connection closed"), { code: "CONNECTION_CLOSED" });
    });
    const repository = createPostgresUploadLinkRepository("postgresql://database.example.test/tools");

    await expect(repository.create(
      new Date(Date.now() + 86_400_000),
      { signal: controller.signal }
    )).rejects.toBe(aborted);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a permanent insert failure", async () => {
    const constraintFailure = Object.assign(new Error("constraint failed"), { code: "23514" });
    sqlMock.mockRejectedValueOnce(constraintFailure);
    const repository = createPostgresUploadLinkRepository("postgresql://database.example.test/tools");

    await expect(repository.create(new Date(Date.now() + 86_400_000))).rejects.toBe(constraintFailure);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});
