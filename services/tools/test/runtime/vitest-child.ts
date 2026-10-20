import { rename, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createVitest, type TestCase, type TestModule, type Vitest } from "vitest/node";
import { redactDatabase, type CaseResult, type ChildReport } from "./receipt.ts";

const [phase, reportPath, ...extra] = process.argv.slice(2);
if ((phase !== "discover" && phase !== "run") || !reportPath || extra.length) {
  throw new Error("Usage: vitest-child.ts <discover|run> <report-path>");
}
const toolsRoot = fileURLToPath(new URL("../../", import.meta.url));

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function identity(test: TestCase) {
  return `${relative(toolsRoot, test.module.moduleId)} > ${test.fullName}`;
}

function moduleErrors(modules: readonly TestModule[]) {
  return modules.flatMap((module) => {
    const name = relative(toolsRoot, module.moduleId);
    const state = module.state();
    const errors = [module, ...module.children.allSuites()].flatMap((suite) => suite.errors().map((error) => `${name}: ${error.message}`));
    const settled = phase === "discover" ? state !== "failed" : state === "passed";
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
    config: join(toolsRoot, "vitest.postgres.config.ts"),
    watch: false,
    reporters: phase === "discover" ? [] : ["default", {
      onTestRunEnd(modules, unhandledErrors, reason) {
        runEnds += 1;
        observed = modules.flatMap((module) => [...module.children.allTests()].map((test) => ({
          identity: identity(test),
          result: test.result().state,
          evidence: test.result().errors?.map((error) => error.message) ?? [],
        })));
        errors.push(...unhandledErrors.map((error) => error.message), ...moduleErrors(modules));
        if (reason !== "passed") errors.push(`Vitest ended ${reason}.`);
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
