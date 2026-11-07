import { beforeEach, expect, it, vi } from "vitest";
import { getCurrentPrincipal } from "../../../platform/auth/session.js";
import { Route } from "../../../app/routes/sign-in.js";

vi.mock("../../../platform/auth/session.js", () => ({ getCurrentPrincipal: vi.fn() }));

beforeEach(() => {
  vi.mocked(getCurrentPrincipal).mockResolvedValue({ role: "admin", subject: "test-subject", email: "person@example.test" });
});

it("keeps signed native sign-in open for an existing session that must log in again", async () => {
  await expect(Route.options.beforeLoad!({
    location: { searchStr: "?client_id=pantrino&prompt=login&sig=signed-request" },
    search: { returnTo: "/" }
  } as never)).resolves.toBeUndefined();
});

it("returns an existing website session to its safe destination", async () => {
  await expect(Route.options.beforeLoad!({
    location: { searchStr: "?returnTo=%2Fkitchen" },
    search: { returnTo: "/kitchen" }
  } as never)).rejects.toMatchObject({ options: { href: "/kitchen" } });
});

it("keeps website sign-in open when there is no session", async () => {
  vi.mocked(getCurrentPrincipal).mockResolvedValue(undefined);
  await expect(Route.options.beforeLoad!({
    location: { searchStr: "?returnTo=%2Fkitchen" },
    search: { returnTo: "/kitchen" }
  } as never)).resolves.toBeUndefined();
});
