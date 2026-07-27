import { runCheckerCli } from "../../src/index.js";
import { MemoryStore, configFixture } from "../helpers.js";

const store = new MemoryStore();
store.readCatalog = async () => new Promise(() => undefined);
store.close = () => {
  store.closed = true;
  console.log("store.closed");
};

setInterval(() => undefined, 1_000);

void runCheckerCli({
  store,
  config: { ...configFixture, runDeadlineMs: 30 },
  cleanupGraceMs: 30
});
