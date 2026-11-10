import { describe, expect, it } from "vitest";
import { loadReviewAccount } from "../../../platform/auth/review-account.js";
import { reviewProvisionTarget } from "../../../platform/auth/provision-review-account.js";

const local = {
  TEST_DATABASE_URL: "postgres://127.0.0.1:15432/review_test",
  TOOLS_TEST_DATABASE_CONFIRM: "tools-platform-test",
  APP_REVIEW_PROVISION_CONFIRM: "pantrino-apple-review"
};

describe("review activation and provision guards", () => {
  it("requires explicit enablement and rejects malformed values", () => {
    expect(loadReviewAccount({})).toBeUndefined();
    expect(loadReviewAccount({ AUTH_APP_REVIEW_ENABLED: "false" })).toBeUndefined();
    expect(loadReviewAccount({ AUTH_APP_REVIEW_ENABLED: "true" })?.username).toBe("apple-review");
    expect(() => loadReviewAccount({ AUTH_APP_REVIEW_ENABLED: "yes" })).toThrow();
  });

  it("requires both the review confirmation and the existing database confirmation", () => {
    expect(reviewProvisionTarget(local, "test").url).toBe(local.TEST_DATABASE_URL);
    expect(() => reviewProvisionTarget({ ...local, APP_REVIEW_PROVISION_CONFIRM: undefined }, "test")).toThrow();
    expect(() => reviewProvisionTarget({ ...local, TOOLS_TEST_DATABASE_CONFIRM: undefined }, "test")).toThrow();
    expect(() => reviewProvisionTarget(local, undefined)).toThrow();
  });

  it("refuses remote test databases and production flags on a local command", () => {
    expect(() => reviewProvisionTarget({ ...local, TEST_DATABASE_URL: "postgres://db.example.test:5432/review_test" }, "test")).toThrow();
    for (const name of ["NODE_ENV", "TOOLS_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME"]) {
      expect(() => reviewProvisionTarget({ ...local, [name]: "production" }, "test")).toThrow();
    }
  });

  it("requires the explicit production mode, confirmation, environment, and private database host", () => {
    const production = {
      APP_REVIEW_PROVISION_CONFIRM: "pantrino-apple-review", DATABASE_URL: "postgres://postgres.railway.internal/review",
      TOOLS_SCHEMA_PUSH_CONFIRM: "tools-platform-production", RAILWAY_ENVIRONMENT_NAME: "production"
    };
    expect(reviewProvisionTarget(production, "production").mode).toBe("production");
    expect(() => reviewProvisionTarget({ ...production, RAILWAY_ENVIRONMENT_NAME: "dev" }, "production")).toThrow();
    expect(() => reviewProvisionTarget({ ...production, TOOLS_SCHEMA_PUSH_CONFIRM: undefined }, "production")).toThrow();
    expect(() => reviewProvisionTarget({ ...production, DATABASE_URL: "postgres://public.example.test/review" }, "production")).toThrow();
  });
});
