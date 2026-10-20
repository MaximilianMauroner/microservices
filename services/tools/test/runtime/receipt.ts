export class VerificationBlocked extends Error {
  override name = "VerificationBlocked";
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
  result: "passed" | "failed" | "blocked" | "skipped" | "pending";
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
  result: (value) => value === "passed" || value === "failed" || value === "blocked" || value === "skipped" || value === "pending",
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

type Journey =
  | Readonly<{ kind: "automated"; suite: "built-tools" | "mounted-status"; scenario: string; identity: string }>
  | Readonly<{ kind: "manual"; scenario: string; requirements: readonly string[] }>;

function automated(scenario: string): Journey & { kind: "automated" } {
  return { kind: "automated", suite: "built-tools", scenario, identity: `test/runtime/journeys.test.ts > built Tools journeys > ${scenario}` };
}

export const mountedStatusCase = "test/status-links.test.tsx > Status navigation links > renders internal, external and Open Tools links without native-button errors";
export const journeyPlan: readonly Journey[] = [
  automated("anonymous-private-document"),
  automated("anonymous-upload-link-post"),
  automated("machine-token-boundary"),
  automated("public-capability-denial"),
  automated("heartbeat-publication"),
  { kind: "automated", suite: "mounted-status", scenario: "mounted-status-links", identity: mountedStatusCase },
  {
    kind: "manual", scenario: "private-google-oauth-upload-link",
    requirements: [
      "Use a real local Google OAuth browser login with the allowed subject on the reviewed revision.",
      "Record POST /api/upload-links returning 201 JSON and a usable guest URL.",
      "Record browser signed PUT and readable ETag evidence with the revision and owned fixture.",
    ],
  },
  {
    kind: "manual", scenario: "authenticated-cross-origin-denial",
    requirements: [
      "Use a real local Google OAuth session on the reviewed revision.",
      "Record cross-origin denial and unchanged canonical state with the revision and owned fixture.",
    ],
  },
  {
    kind: "manual", scenario: "historical-pre-middleware-upload-link",
    requirements: [
      "Use separately owned built stacks for 98f7ca5^, 98f7ca5, and the reviewed revision with real local Google OAuth sessions.",
      "Record the before/after HTTP responses and bind browser evidence to each revision and owned fixture.",
    ],
  },
];
const automatedJourneys = journeyPlan.filter((journey) => journey.kind === "automated");
export const requiredJourneyCases = automatedJourneys.map(({ identity }) => identity);

export type CheckReceipt = Readonly<{
  kind: "automated";
  suite: string;
  scenario: string;
  revision: string;
  fixture: string;
  result: "passed" | "failed" | "blocked";
  evidence: readonly string[];
}>;

export function manualAcceptance(revision: string) {
  return {
    kind: "blocked" as const,
    owner: "Max" as const,
    revision,
    gates: journeyPlan.filter((journey) => journey.kind === "manual").map((journey) => ({
      ...journey, owner: "Max" as const, revision, result: "blocked" as const,
      evidence: ["Unrun. Max must review revision-bound evidence before merge. Automation cannot accept this gate."],
    })),
  };
}

export function journeyReceipts(revision: string, fixture: string, observed?: readonly CaseResult[], runErrors: readonly string[] = []): CheckReceipt[] {
  const reconciliation = requiredCaseReceipt(requiredJourneyCases, observed ?? [], runErrors);
  return automatedJourneys.map(({ suite, scenario, identity }) => {
    const test = observed?.find((test) => test.identity === identity);
    return {
      kind: "automated", suite, scenario, revision, fixture,
      result: observed ? reconciliation.result === "passed" ? "passed" : "failed" : "blocked",
      evidence: [identity, ...(test ? test.evidence : [observed ? "Required case is missing." : "Journey execution has not run."]), ...reconciliation.evidence],
    };
  });
}

export function redactFixture(text: string, environment: Readonly<Record<string, string | undefined>>) {
  const secrets = new Set<string>();
  for (const [name, value] of Object.entries(environment)) {
    if (!value || !/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(name)) continue;
    secrets.add(value);
    if (name.includes("DATABASE_URL")) {
      const password = new URL(value).password;
      if (password) {
        secrets.add(password);
        secrets.add(decodeURIComponent(password));
      }
    }
  }
  for (const value of [...secrets].sort((a, b) => b.length - a.length)) text = text.replaceAll(value, "[redacted]");
  return text.replace(/(postgres(?:ql)?:\/\/[^\s:/@]*:)[^\s@'"`\\]+/g, "$1[redacted]")
    .replace(/([?&]X-Amz-[^=\s]+)=([^&\s]+)/gi, "$1=[redacted]");
}
