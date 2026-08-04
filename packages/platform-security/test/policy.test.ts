import { describe, expect, it } from "vitest";
import { classifyRoute } from "../src/index.js";

describe("central platform route policy", () => {
  it("keeps public reads, machine APIs, and Access families distinct", () => {
    expect(classifyRoute("/", "GET")).toEqual({ kind: "public" });
    expect(classifyRoute("/api/public/catalog", "HEAD")).toEqual({ kind: "public" });
    expect(classifyRoute("/artifacts/abc", "GET")).toEqual({ kind: "public" });
    expect(classifyRoute("/artifacts/abc", "POST")).toEqual({ kind: "access", family: "publisher" });
    expect(classifyRoute("/api/uploads", "POST")).toEqual({ kind: "machine", service: "uploads" });
    expect(classifyRoute("/api/agent/status", "GET")).toEqual({ kind: "machine", service: "agent" });
    expect(classifyRoute("/api/heartbeat/tower", "POST")).toEqual({ kind: "machine", service: "heartbeat" });
    expect(classifyRoute("/api/review/queue", "GET")).toEqual({ kind: "access", family: "review" });
    expect(classifyRoute("/manage/status", "GET")).toEqual({ kind: "access", family: "manage" });
  });

  it("does not widen exact public asset exceptions", () => {
    expect(classifyRoute("/assets/ops.js", "GET")).toEqual({ kind: "public" });
    expect(classifyRoute("/assets/local-time.js", "GET")).toEqual({ kind: "public" });
    expect(classifyRoute("/assets/ops.js.map", "GET")).toEqual({ kind: "access", family: "manage" });
    expect(classifyRoute("/api/agentic", "GET")).toEqual({ kind: "access", family: "manage" });
  });
});
