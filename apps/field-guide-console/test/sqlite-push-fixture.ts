import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const serviceDirectory = fileURLToPath(new URL("..", import.meta.url));
let templateDirectory: string | undefined;
let templatePath: string | undefined;

/** Creates disposable SQLite test databases from the same guarded push used in development. */
export function prepareSQLiteTestDatabase(path: string) {
  if (!templatePath) {
    templateDirectory = mkdtempSync(join(tmpdir(), "field-guide-sqlite-template-"));
    templatePath = join(templateDirectory, "template.sqlite");
    const result = spawnSync("bun", ["src/push-sqlite.ts"], {
      cwd: serviceDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        SQLITE_PATH: templatePath,
        FIELD_GUIDE_SQLITE_PUSH_CONFIRM: "field-guide-console-sqlite",
      },
    });
    if (result.status !== 0) {
      throw new Error(`Disposable SQLite schema push failed: ${result.stderr || result.stdout}`);
    }
  }
  copyFileSync(templatePath, path);
}

process.once("exit", () => {
  if (templateDirectory) rmSync(templateDirectory, { recursive: true, force: true });
});
