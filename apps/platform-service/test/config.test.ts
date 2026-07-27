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

  it("uses the first legacy audience when older config provides only one", () => {
    expect(routeAudiences({}, ["shared"])).toEqual({
      manage: ["shared"],
      publisher: ["shared"],
      review: ["shared"],
    });
  });

  it("prefers explicit, deduplicated route-family overrides", () => {
    expect(
      routeAudiences(
        {
          CF_ACCESS_MANAGE_AUDIENCE: "manage-a, manage-b, manage-a",
          CF_ACCESS_PUBLISHER_AUDIENCE: "publisher",
          CF_ACCESS_REVIEW_AUDIENCE: "review",
        },
        ["legacy"],
      ),
    ).toEqual({
      manage: ["manage-a", "manage-b"],
      publisher: ["publisher"],
      review: ["review"],
    });
  });

  it("rejects empty explicit overrides", () => {
    expect(() =>
      routeAudiences({ CF_ACCESS_REVIEW_AUDIENCE: " , " }, ["legacy"]),
    ).toThrow("Route-family Access audience must not be empty");
  });
});
