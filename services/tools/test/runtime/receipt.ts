export class VerificationBlocked extends Error {}

export function isMissingExecutable(error: unknown) {
  return error instanceof Error
    && "code" in error && error.code === "ENOENT"
    && "syscall" in error && typeof error.syscall === "string" && error.syscall.startsWith("spawn ");
}

export function redactDatabase(text: string, url: string | undefined) {
  if (!url) return text;
  const { password } = new URL(url);
  const withoutUrl = text.replaceAll(url, "[owned-postgres]");
  const withoutPassword = password ? withoutUrl.replaceAll(password, "[redacted]") : withoutUrl;
  return withoutPassword.replace(/(postgres(?:ql)?:\/\/[^\s:/@]*:)[^\s@'"`\\]+/g, "$1[redacted]");
}

export type CaseResult = Readonly<{
  identity: string;
  result: "passed" | "failed" | "skipped" | "pending";
  evidence: readonly string[];
}>;

export type ChildReport =
  | Readonly<{ phase: "discover"; required: readonly string[]; errors: readonly string[] }>
  | Readonly<{ phase: "run"; observed: readonly CaseResult[]; errors: readonly string[] }>;

type Shape = Readonly<Record<string, (value: unknown) => boolean>>;

function matches(value: unknown, shape: Shape) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length === Object.keys(shape).length && entries.every(([key, item]) => Object.hasOwn(shape, key) && shape[key]!(item));
}

const isStrings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");
const caseResult: Shape = {
  identity: (value) => typeof value === "string",
  result: (value) => value === "passed" || value === "failed" || value === "skipped" || value === "pending",
  evidence: isStrings,
};
const reportShapes: Readonly<Record<ChildReport["phase"], Shape>> = {
  discover: { phase: (value) => value === "discover", required: isStrings, errors: isStrings },
  run: { phase: (value) => value === "run", observed: (value) => Array.isArray(value) && value.every((test) => matches(test, caseResult)), errors: isStrings },
};

export function decodeReport<Phase extends ChildReport["phase"]>(text: string | undefined, phase: Phase): Extract<ChildReport, { phase: Phase }> {
  if (text === undefined) throw new Error(`Vitest ${phase} child wrote no report.`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Vitest ${phase} child report is not JSON.`);
  }
  if (!matches(value, reportShapes[phase])) throw new Error(`Vitest ${phase} child report has an invalid shape.`);
  return value as Extract<ChildReport, { phase: Phase }>;
}

export function requiredCaseReceipt(
  required: readonly string[],
  observed: readonly CaseResult[],
  runErrors: readonly string[],
) {
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
    result: evidence.length ? "failed" : "passed",
    required: [...required],
    executed: observed.filter(({ result }) => result === "passed" || result === "failed").map(({ identity }) => identity),
    skipped: observed.filter(({ result }) => result === "skipped").map(({ identity }) => identity),
    evidence,
  };
}
