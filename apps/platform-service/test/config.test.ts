import { describe, expect, it } from "vitest";
import { routeAudiences } from "../src/config.ts";

describe("platform route-family Access audiences", () => {
  it("maps ordered legacy audiences to distinct route families", () => {
    expect(routeAudiences({}, ["manage", "publisher", "review"])).toEqual({
      manage: ["manage"],
      publisher: ["publisher"],
      review: ["review"],
    });
  });

  it("keeps a shared legacy audience available only outside production", () => {
    expect(routeAudiences({}, ["shared"])).toEqual({
      manage: ["shared"],
      publisher: ["shared"],
      review: ["shared"],
    });
  });

  it("accepts explicit, distinct route-family audiences", () => {
    expect(
      routeAudiences(
        {
          CF_ACCESS_MANAGE_AUDIENCE: "manage",
          CF_ACCESS_PUBLISHER_AUDIENCE: "publisher",
          CF_ACCESS_REVIEW_AUDIENCE: "review",
        },
        ["legacy"],
      ),
    ).toEqual({
      manage: ["manage"],
      publisher: ["publisher"],
      review: ["review"],
    });
  });

  it("fails closed when production family audiences are missing or incomplete", () => {
    expect(() =>
      routeAudiences({ NODE_ENV: "production" }, ["legacy-a", "legacy-b", "legacy-c"]),
    ).toThrow("CF_ACCESS_MANAGE_AUDIENCE is required");
    expect(() =>
      routeAudiences(
        {
          NODE_ENV: "production",
          CF_ACCESS_MANAGE_AUDIENCE: "manage",
          CF_ACCESS_PUBLISHER_AUDIENCE: "publisher",
        },
        ["legacy-a", "legacy-b", "legacy-c"],
      ),
    ).toThrow("CF_ACCESS_REVIEW_AUDIENCE is required");
  });

  it("rejects ambiguous or overlapping explicit family audiences", () => {
    expect(() =>
      routeAudiences(
        {
          NODE_ENV: "production",
          CF_ACCESS_MANAGE_AUDIENCE: "manage-a,manage-b",
          CF_ACCESS_PUBLISHER_AUDIENCE: "publisher",
          CF_ACCESS_REVIEW_AUDIENCE: "review",
        },
        [],
      ),
    ).toThrow("must contain exactly one audience tag");
    expect(() =>
      routeAudiences(
        {
          NODE_ENV: "production",
          CF_ACCESS_MANAGE_AUDIENCE: "shared",
          CF_ACCESS_PUBLISHER_AUDIENCE: "shared",
          CF_ACCESS_REVIEW_AUDIENCE: "review",
        },
        [],
      ),
    ).toThrow("overlaps manage and publisher");
  });
});
