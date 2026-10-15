import { describe, expect, it } from "vitest";
import { requiredCaseReceipt, type CaseResult } from "./receipt.ts";

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
