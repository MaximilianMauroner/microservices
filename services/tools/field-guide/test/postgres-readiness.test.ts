import { describe, expect, it, vi } from "vitest";
import {
  POSTGRES_READINESS_RETRY_DELAYS_MS,
  waitForPostgres
} from "../src/postgres-readiness.js";

describe("PostgreSQL deployment readiness", () => {
  it("keeps the scheduled retry delay within the deployment startup budget", () => {
    expect(POSTGRES_READINESS_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0))
      .toBe(25_000);
  });

  it("waits for a cold database before schema work starts", async () => {
    const check = vi.fn()
      .mockRejectedValueOnce(new Error("database starting"))
      .mockRejectedValueOnce(new Error("database starting"))
      .mockResolvedValueOnce(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);

    await waitForPostgres(check, [100, 250], wait);

    expect(check).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 100);
    expect(wait).toHaveBeenNthCalledWith(2, 250);
  });

  it("fails with the last connection error after the retry budget", async () => {
    const finalError = new Error("database unavailable");
    const check = vi.fn()
      .mockRejectedValueOnce(new Error("database starting"))
      .mockRejectedValueOnce(finalError);

    await expect(waitForPostgres(check, [0], async () => {})).rejects.toBe(finalError);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
