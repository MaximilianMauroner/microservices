import { describe, expect, it } from "vitest";
import {
  attachPlatformPrincipal,
  classifyRoute,
  getAttachedPlatformPrincipal
} from "../src/index.js";

describe("central platform route policy", () => {
  it("keeps public reads, human sessions, and machine APIs distinct", () => {
    expect(classifyRoute("/", "GET")).toEqual({ kind: "human-session" });
    expect(classifyRoute("/sign-in", "GET")).toEqual({ kind: "public" });
    expect(classifyRoute("/api/auth/callback/google", "GET")).toEqual({ kind: "public" });
    expect(classifyRoute("/status", "GET")).toEqual({ kind: "human-session" });
    expect(classifyRoute("/api/public/catalog", "HEAD")).toEqual({ kind: "human-session" });
    expect(classifyRoute("/artifacts/abc", "GET")).toEqual({ kind: "public" });
    expect(classifyRoute("/artifacts/abc", "HEAD")).toEqual({ kind: "public" });
    expect(classifyRoute("/files/abc/index.html", "GET")).toEqual({ kind: "public" });
    expect(classifyRoute("/files/abc/index.html", "HEAD")).toEqual({ kind: "public" });
    expect(classifyRoute("/artifacts/abc", "POST")).toEqual({ kind: "human-session" });
    expect(classifyRoute("/files/abc/index.html", "DELETE")).toEqual({ kind: "human-session" });
    expect(classifyRoute("/api/uploads", "POST")).toEqual({ kind: "machine", service: "uploads" });
    expect(classifyRoute("/api/agent/status", "GET")).toEqual({ kind: "machine", service: "agent" });
    expect(classifyRoute("/api/status/heartbeats/tower", "POST")).toEqual({ kind: "machine", service: "heartbeat" });
    expect(classifyRoute("/api/review/queue", "GET")).toEqual({ kind: "human-session" });
    expect(classifyRoute("/manage/status", "GET")).toEqual({ kind: "human-session" });
    expect(classifyRoute("/_serverFn/getPublicPageData", "GET")).toEqual({ kind: "server-function" });
  });

  it("does not widen exact public asset exceptions", () => {
    expect(classifyRoute("/theme.js", "GET")).toEqual({ kind: "public" });
    expect(classifyRoute("/theme.js.map", "GET")).toEqual({ kind: "human-session" });
    expect(classifyRoute("/assets/ops.js", "GET")).toEqual({ kind: "public" });
    expect(classifyRoute("/assets/local-time.js", "GET")).toEqual({ kind: "public" });
    expect(classifyRoute("/assets/ops.js.map", "GET")).toEqual({ kind: "human-session" });
    expect(classifyRoute("/api/agentic", "GET")).toEqual({ kind: "human-session" });
  });

  it("attaches a verified principal without exposing it as a header", () => {
    const request = new Request("https://tools.example.test/manage");
    const principal = { subject: "google-subject", email: "operator@example.test" };
    attachPlatformPrincipal(request, principal);
    expect(getAttachedPlatformPrincipal(request)).toEqual(principal);
    expect([...request.headers]).toEqual([]);
  });
});
