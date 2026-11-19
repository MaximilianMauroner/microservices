import { mock } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { runCheckerCli } from "../../../../products/status/index.js";
import { MemoryStore, configFixture } from "../helpers.js";

const store = new MemoryStore();
store.readCatalog = async () => new Promise(() => undefined);
store.close = () => {
  store.closed = true;
  console.log("store.closed");
};

setInterval(() => undefined, 1_000);
mock.timers.enable({ apis: ["setTimeout"] });

const runDeadlineMs = 30;
const settlementGraceMs = 15;
const cleanupGraceMs = 30;
process.send?.("ready");
void runCheckerCli({
  store,
  config: { ...configFixture, runDeadlineMs },
  cleanupGraceMs,
  settlementGraceMs
});
mock.timers.tick(runDeadlineMs);
await nextTurn();
mock.timers.tick(settlementGraceMs);
await nextTurn();
mock.timers.tick(cleanupGraceMs - settlementGraceMs);
