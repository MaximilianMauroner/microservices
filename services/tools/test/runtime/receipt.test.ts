import { describe, expect, it } from "vitest";
import { decodeReport, redactDatabase, redactFixture, manualAcceptance, requiredCaseReceipt, type CaseResult, journeyReceipts, requiredJourneyCases, mountedStatusCase } from "./receipt.ts";

const required = ["money > first", "money > second"];
const passed: CaseResult[] = required.map((identity) => ({ identity, result: "passed", evidence: [] }));

describe("required PostgreSQL receipt", () => {
  it("accepts exactly the discovered cases when the reporter records each pass", () => {
    expect(requiredCaseReceipt(required, passed, [])).toMatchObject({
      result: "passed", required, executed: required, skipped: [],
    });
  });

  it("rejects the historical all-skipped result even if Vitest exits successfully", () => {
    const skipped = passed.map((test) => ({ ...test, result: "skipped" as const }));
    expect(requiredCaseReceipt(required, skipped, [])).toMatchObject({
      result: "failed", required, executed: [], skipped: required,
    });
  });

  it.each([
    { name: "zero discovered cases", expected: [], actual: [], error: "No required cases" },
    { name: "filtered case", expected: required, actual: passed.slice(0, 1), error: "missing from the reporter" },
    { name: "duplicate required identity", expected: [required[0]!, required[0]!], actual: passed, error: "Required case identities are duplicated" },
    { name: "duplicate reporter identity", expected: required, actual: [passed[0]!, passed[0]!], error: "Reporter case identities are duplicated" },
    { name: "same count with wrong identity", expected: required, actual: [passed[0]!, { ...passed[1]!, identity: "money > other" }], error: "not discovered" },
    { name: "required skip", expected: required, actual: [passed[0]!, { ...passed[1]!, result: "skipped" as const }], error: "skipped:" },
    { name: "required todo or incomplete case", expected: required, actual: [passed[0]!, { ...passed[1]!, result: "pending" as const }], error: "pending:" },
    { name: "failed assertion", expected: required, actual: [passed[0]!, { ...passed[1]!, result: "failed" as const, evidence: ["SQL projection failed"] }], error: "SQL projection failed" },
  ])("rejects $name", ({ expected, actual, error }) => {
    const receipt = requiredCaseReceipt(expected, actual, []);
    expect(receipt).toMatchObject({ result: "failed" });
    expect(receipt.evidence.join("\n")).toContain(error);
  });

  it("rejects module, hook, process, or reporter errors despite individual passes", () => {
    expect(requiredCaseReceipt(required, passed, ["afterAll failed"])).toMatchObject({
      result: "failed", evidence: ["afterAll failed"],
    });
  });
});

describe("Vitest child report boundary", () => {
  const discover = { phase: "discover", required, errors: [] };
  const run = { phase: "run", observed: passed, errors: ["afterAll failed"] };

  it("returns a well-formed report for its phase", () => {
    expect(decodeReport(JSON.stringify(discover), "discover")).toEqual(discover);
    expect(decodeReport(JSON.stringify(run), "run")).toEqual(run);
  });

  it.each([
    { name: "a missing report", text: undefined, phase: "run" as const, error: "wrote no report" },
    { name: "a truncated report", text: JSON.stringify(run).slice(0, -1), phase: "run" as const, error: "not JSON" },
    { name: "the other phase", text: JSON.stringify(discover), phase: "run" as const, error: "invalid shape" },
    { name: "an unknown field", text: JSON.stringify({ ...discover, version: 1 }), phase: "discover" as const, error: "invalid shape" },
    { name: "missing errors", text: JSON.stringify({ phase: "discover", required }), phase: "discover" as const, error: "invalid shape" },
    { name: "a non-text error", text: JSON.stringify({ ...run, errors: [{ message: "afterAll failed" }] }), phase: "run" as const, error: "invalid shape" },
    { name: "an unknown outcome", text: JSON.stringify({ ...run, observed: [{ ...passed[0], result: "todo" }] }), phase: "run" as const, error: "invalid shape" },
    { name: "a case without evidence", text: JSON.stringify({ ...run, observed: [{ identity: required[0], result: "passed" }] }), phase: "run" as const, error: "invalid shape" },
    { name: "an inherited key", text: '{"phase":"discover","required":[],"__proto__":[]}', phase: "discover" as const, error: "invalid shape" },
    { name: "a bare list", text: JSON.stringify(required), phase: "discover" as const, error: "invalid shape" },
  ])("rejects $name", ({ text, phase, error }) => {
    expect(() => decodeReport(text, phase)).toThrow(error);
  });
});

describe("fixture credential redaction", () => {
  const url = "postgres://tools_runtime:0123456789abcdef0123456789abcdef@127.0.0.1:54321/tools_runtime";

  it("removes the URL, the bare password and a password that a reporter truncated", () => {
    const text = `connect ${url} failed; password 0123456789abcdef0123456789abcdef; expected 'postgres://tools_runtime:0123456789abc…' to be 'other'`;
    const redacted = redactDatabase(text, url);
    expect(redacted).toBe("connect [owned-postgres] failed; password [redacted]; expected 'postgres://tools_runtime:[redacted]' to be 'other'");
  });

  it("redacts every fixture credential including encoded database passwords and signed URL fields", () => {
    const environment = {
      DATABASE_URL: "postgres://user:encoded%2Fpassword@127.0.0.1:9/postgres",
      TOOLS_S3_ACCESS_KEY_ID: "storage-access", TOOLS_S3_SECRET_ACCESS_KEY: "storage-secret",
      TOWER_HEARTBEAT_TOKEN: "heartbeat-secret", TOOLS_JOURNEY_UPLOAD_TOKEN: "upload-secret",
      FEEDBACK_ENCRYPTION_KEY: "feedback-key", GOOGLE_CLIENT_SECRET: "oauth-secret", BETTER_AUTH_SECRET: "session-secret",
    };
    const text = [...Object.values(environment), "encoded/password", "encoded%2Fpassword", "http://127.0.0.1/file?X-Amz-Signature=signed-secret"].join(" ");
    const redacted = redactFixture(text, environment);
    for (const secret of [...Object.values(environment), "encoded/password", "encoded%2Fpassword", "signed-secret"]) {
      expect(redacted).not.toContain(secret);
    }
  });

  it("leaves text unchanged when no fixture exists", () => {
    expect(redactDatabase("postgres://user:value@host/db", undefined)).toBe("postgres://user:value@host/db");
  });
});

describe("required runtime journey receipts", () => {
  const observations: CaseResult[] = requiredJourneyCases.map((identity) => ({ identity, result: "passed", evidence: [] }));

  it("rejects a missing mounted Status regression even when every built HTTP check passes", () => {
    const observed = observations.filter((test) => test.identity !== mountedStatusCase);
    expect(requiredCaseReceipt(requiredJourneyCases, observed, []).result).toBe("failed");
    expect(journeyReceipts("revision", "fixture", observed).find((receipt) => receipt.suite === "mounted-status"))
      .toMatchObject({ result: "failed", evidence: expect.arrayContaining(["Required case is missing."]) });
  });

  it("keeps all three manual gates blocked and revision-bound when every automated case passes", () => {
    expect(requiredCaseReceipt(requiredJourneyCases, observations, []).result).toBe("passed");
    expect(journeyReceipts("revision", "fixture", observations).every((receipt) => receipt.result === "passed")).toBe(true);
    const manual = manualAcceptance("reviewed-revision");
    expect(manual).toMatchObject({ kind: "blocked", owner: "Max", revision: "reviewed-revision" });
    expect(manual.gates.map(({ scenario }) => scenario)).toEqual([
      "private-google-oauth-upload-link", "authenticated-cross-origin-denial", "historical-pre-middleware-upload-link",
    ]);
    for (const gate of manual.gates) {
      expect(gate).toMatchObject({ kind: "manual", owner: "Max", revision: "reviewed-revision", result: "blocked" });
      expect(gate.requirements.length).toBeGreaterThan(0);
      expect(gate.evidence.join(" ")).toContain("Unrun");
      expect(requiredJourneyCases.some((identity) => identity.endsWith(gate.scenario))).toBe(false);
    }
  });

  it.each(["blocked", "pending", "skipped", "failed"] as const)("never accepts an automated %s case", (result) => {
    const observed = observations.map((test, index) => index === 0 ? { ...test, result } : test);
    expect(requiredCaseReceipt(requiredJourneyCases, observed, []).result).toBe("failed");
    expect(journeyReceipts("revision", "fixture", observed).every((receipt) => receipt.result === "failed")).toBe(true);
  });

  it("cannot import a manual acceptance through an automated report", () => {
    const observed = [...observations, { identity: "test/runtime/journeys.test.ts > built Tools journeys > private-google-oauth-upload-link", result: "passed" as const, evidence: ["claimed acceptance"] }];
    expect(requiredCaseReceipt(requiredJourneyCases, observed, []).result).toBe("failed");
    expect(journeyReceipts("revision", "fixture", observed).every((receipt) => receipt.result === "failed")).toBe(true);
    expect(manualAcceptance("revision").kind).toBe("blocked");
  });

  it("does not issue named acceptance passes when the suite reports a hook error", () => {
    const errors = ["test/status-links.test.tsx: afterAll failed"];
    const receipts = journeyReceipts("revision", "fixture", observations, errors);
    expect(receipts.every((receipt) => receipt.result === "failed")).toBe(true);
    expect(receipts.find((receipt) => receipt.suite === "mounted-status")?.evidence).toContain(errors[0]);
  });

  it("never reports unrun journeys as passed", () => {
    expect(journeyReceipts("revision", "unavailable").every((receipt) => receipt.result === "blocked")).toBe(true);
    expect(requiredCaseReceipt(requiredJourneyCases, [], []).result).toBe("failed");
  });
});
