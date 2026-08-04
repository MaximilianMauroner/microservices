import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function readReviewStylesheet(): Promise<Uint8Array> {
  return readFile(resolve(process.cwd(), "../field-guide-console/public/review.css"));
}
