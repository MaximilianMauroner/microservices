import { describe, expect, it } from "vitest";
import { decodeReport, redactDatabase, requiredCaseReceipt, type CaseResult } from "./receipt.ts";

const context = { suite: "money-postgres", scenario: "required-contracts", revision: "revision", fixture: "owned-fixture" };
const required = ["money > first", "money > second"];
const passed: CaseResult[] = required.map((identity) => ({ identity, result: "passed", evidence: [] }));

describe("required PostgreSQL receipt", () => {
  it("accepts exactly the discovered cases when the reporter records each pass", () => {
    expect(requiredCaseReceipt(context, required, passed, [])).toMatchObject({
      ...context, result: "passed", exitStatus: 0, required, executed: required, skipped: [],
    });
  });

  it("rejects the historical all-skipped result even if Vitest exits successfully", () => {
    const skipped = passed.map((test) => ({ ...test, result: "skipped" as const }));
    expect(requiredCaseReceipt(context, required, skipped, [])).toMatchObject({
      result: "failed", exitStatus: 1, required, executed: [], skipped: required,
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
    const receipt = requiredCaseReceipt(context, expected, actual, []);
    expect(receipt).toMatchObject({ result: "failed", exitStatus: 1 });
    expect(receipt.evidence.join("\n")).toContain(error);
  });

  it("rejects module, hook, process, or reporter errors despite individual passes", () => {
    expect(requiredCaseReceipt(context, required, passed, ["afterAll failed"])).toMatchObject({
      result: "failed", exitStatus: 1, evidence: ["afterAll failed"],
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

  it("leaves text unchanged when no fixture exists", () => {
    expect(redactDatabase("postgres://user:value@host/db", undefined)).toBe("postgres://user:value@host/db");
  });
});
