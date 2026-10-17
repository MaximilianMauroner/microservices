import { rename, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createVitest, type TestCase, type TestModule, type Vitest } from "vitest/node";
import { redactDatabase, type CaseResult, type ChildReport } from "./receipt.ts";

const [phase, reportPath, suite = "postgres", ...extra] = process.argv.slice(2);
if ((phase !== "discover" && phase !== "run") || !reportPath || !["postgres", "identity", "journeys"].includes(suite) || extra.length) {
  throw new Error("Usage: vitest-child.ts <discover|run> <report-path> [postgres|identity|journeys]");
}
const toolsRoot = fileURLToPath(new URL("../../", import.meta.url));

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function identity(test: TestCase) {
  return `${relative(toolsRoot, test.module.moduleId)} > ${test.fullName}`;
}

function caseResult(test: TestCase): CaseResult {
  const result = test.result();
  const errors = result.errors ?? [];
  const blocked = result.state === "failed" && errors.length > 0
    && errors.every((error) => error.name === "VerificationBlocked");
  return {
    identity: identity(test),
    result: blocked ? "blocked" : result.state,
    evidence: errors.map((error) => error.message),
  };
}

function moduleErrors(modules: readonly TestModule[]) {
  return modules.flatMap((module) => {
    const name = relative(toolsRoot, module.moduleId);
    const state = module.state();
    const errors = [module, ...module.children.allSuites()].flatMap((suite) => suite.errors().map((error) => `${name}: ${error.message}`));
    const cases = [...module.children.allTests()].map(caseResult);
    const blockedOnly = suite === "journeys" && phase === "run"
      && cases.some((test) => test.result === "blocked")
      && cases.every((test) => test.result === "passed" || test.result === "blocked");
    const settled = phase === "discover" ? state !== "failed" : state === "passed" || blockedOnly;
    return settled ? errors : [`Module ${name} ended ${state}.`, ...errors];
  });
}

const errors: string[] = [];
let required: string[] = [];
let observed: CaseResult[] = [];
let runEnds = 0;
let vitest: Vitest | undefined;
try {
  vitest = await createVitest("test", {
    root: toolsRoot,
    config: join(toolsRoot, suite === "journeys" ? "vitest.journeys.config.ts" : suite === "identity" ? "vitest.identity.config.ts" : "vitest.postgres.config.ts"),
    watch: false,
    reporters: phase === "discover" ? [] : ["default", {
      onTestRunEnd(modules, unhandledErrors, reason) {
        runEnds += 1;
        observed = modules.flatMap((module) => [...module.children.allTests()].map(caseResult));
        errors.push(...unhandledErrors.map((error) => error.message), ...moduleErrors(modules));
        if (reason !== "passed" && !(suite === "journeys" && observed.some((test) => test.result === "blocked")
          && observed.every((test) => test.result === "passed" || test.result === "blocked"))) errors.push(`Vitest ended ${reason}.`);
      },
    }],
  });
  if (phase === "discover") {
    const collected = await vitest.collectTests(await vitest.globTestSpecifications());
    required = collected.testModules.flatMap((module) => [...module.children.allTests()].map(identity));
    errors.push(...collected.unhandledErrors.map(message), ...moduleErrors(collected.testModules));
  } else {
    await vitest.start();
    if (runEnds !== 1) errors.push(`Vitest reported the end of the run ${runEnds} times.`);
  }
} catch (error) {
  errors.push(message(error));
} finally {
  try {
    await vitest?.close();
  } catch (error) {
    errors.push(`Vitest did not close. ${message(error)}`);
  }
}

const report: ChildReport = phase === "discover" ? { phase, required, errors } : { phase, observed, errors };
const redacted = JSON.stringify(report, (_key, value: unknown) => typeof value === "string" ? redactDatabase(value, process.env.TEST_DATABASE_URL) : value, 2);
await writeFile(`${reportPath}.tmp`, redacted);
await rename(`${reportPath}.tmp`, reportPath);
if (errors.length || observed.some((test) => test.result !== "passed")) process.exitCode = 1;
