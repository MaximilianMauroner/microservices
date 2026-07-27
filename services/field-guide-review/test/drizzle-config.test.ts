import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const serviceDirectory=fileURLToPath(new URL("..",import.meta.url));
function load(sqlitePath?:string){const env={...process.env};if(sqlitePath===undefined)delete env.SQLITE_PATH;else env.SQLITE_PATH=sqlitePath;return spawnSync("bun",["-e",'import("./drizzle.config.ts")'],{cwd:serviceDirectory,encoding:"utf8",env});}
describe("SQLite Drizzle config",()=>{it("uses the production volume path by default",()=>expect(load().status).toBe(0));it("accepts an absolute path",()=>expect(load("/tmp/field-guide.sqlite").status).toBe(0));it("rejects relative paths",()=>{const result=load("data/field-guide.sqlite");expect(result.status).not.toBe(0);expect(result.stderr).toContain("absolute");});});
