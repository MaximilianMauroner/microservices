export type CaseResult = Readonly<{
  identity: string;
  result: "passed" | "failed" | "skipped" | "pending";
  evidence: readonly string[];
}>;

export type CheckReceipt = Readonly<{
  suite: string;
  scenario: string;
  revision: string;
  fixture: string;
  result: "passed" | "failed" | "blocked";
  evidence: readonly string[];
  required: readonly string[];
  executed: readonly string[];
  skipped: readonly string[];
  exitStatus: number;
}>;

export function requiredCaseReceipt(
  context: Pick<CheckReceipt, "suite" | "scenario" | "revision" | "fixture">,
  required: readonly string[],
  observed: readonly CaseResult[],
  runErrors: readonly string[],
): CheckReceipt {
  const evidence = [...runErrors];
  const requiredSet = new Set(required);
  const observedSet = new Set(observed.map(({ identity }) => identity));
  if (!required.length) evidence.push("No required cases were discovered.");
  if (requiredSet.size !== required.length) evidence.push("Required case identities are duplicated.");
  if (observedSet.size !== observed.length) evidence.push("Reporter case identities are duplicated.");
  for (const identity of requiredSet) {
    if (!observedSet.has(identity)) evidence.push(`Required case is missing from the reporter: ${identity}`);
  }
  for (const test of observed) {
    if (!requiredSet.has(test.identity)) evidence.push(`Reporter case was not discovered: ${test.identity}`);
    if (test.result !== "passed") evidence.push(`${test.result}: ${test.identity}`, ...test.evidence);
  }
  return {
    ...context,
    result: evidence.length ? "failed" : "passed",
    required: [...required],
    executed: observed.filter(({ result }) => result === "passed" || result === "failed").map(({ identity }) => identity),
    skipped: observed.filter(({ result }) => result === "skipped").map(({ identity }) => identity),
    evidence,
    exitStatus: evidence.length ? 1 : 0,
  };
}
