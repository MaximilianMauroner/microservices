import { posix } from "node:path";
import { unzipSync } from "fflate";
import { SaxesParser } from "saxes";
import { BodyshopError } from "../domain.js";

/** One cell as stored: its value, its type, and whether a formula made it. */
export type Cell = Readonly<{ value: string; type: string; formula: boolean }>;
/** Rows by row number, then cells by column letter. */
export type Sheet = Readonly<{ name: string; rows: ReadonlyMap<number, ReadonlyMap<string, Cell>>; comments: ReadonlyMap<string, string> }>;

const MAX_EXTRACTED_BYTES = 160 * 1024 * 1024;

/**
 * Reads the named sheets of an xlsx file. Other sheets, images, and charts are not opened.
 * A missing sheet is left out of the result; the caller decides whether it is required.
 */
export function readWorkbook(bytes: Uint8Array, wanted: readonly string[]): Map<string, Sheet> {
  const workbook = unzip(bytes, (name) => name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels" || name === "xl/sharedStrings.xml");
  const sheets: { name: string; relationship: string }[] = [];
  parse(text(workbook, "xl/workbook.xml"), (parser) => parser.on("opentag", (tag) => {
    if (tag.name === "sheet") sheets.push({ name: String(tag.attributes.name ?? ""), relationship: String(tag.attributes["r:id"] ?? "") });
  }));
  const targets = new Map<string, string>();
  parse(text(workbook, "xl/_rels/workbook.xml.rels"), (parser) => parser.on("opentag", (tag) => {
    if (tag.name === "Relationship") targets.set(String(tag.attributes.Id), resolve("xl", String(tag.attributes.Target ?? "")));
  }));
  const paths = new Map(sheets.filter((sheet) => wanted.includes(sheet.name)).map((sheet) => [sheet.name, targets.get(sheet.relationship) ?? ""]));
  const relationFiles = new Set([...paths.values()].map((path) => posix.join(posix.dirname(path), "_rels", `${posix.basename(path)}.rels`)));
  const parts = unzip(bytes, (name) => [...paths.values()].includes(name) || relationFiles.has(name) || /^xl\/comments\d*\.xml$/.test(name));
  const strings = sharedStrings(workbook["xl/sharedStrings.xml"] ? text(workbook, "xl/sharedStrings.xml") : "");

  const result = new Map<string, Sheet>();
  for (const [name, path] of paths) {
    if (!parts[path]) continue;
    result.set(name, { name, rows: cells(text(parts, path), strings), comments: comments(parts, path) });
  }
  return result;
}

function unzip(bytes: Uint8Array, keep: (name: string) => boolean): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(bytes, { filter(file) {
      if (!keep(file.name)) return false;
      total += file.originalSize;
      if (total > MAX_EXTRACTED_BYTES) throw new BodyshopError("The workbook is too large to read.", "too_large");
      return true;
    } });
  } catch (error) {
    if (error instanceof BodyshopError) throw error;
    throw new BodyshopError("The file is not a readable xlsx workbook.");
  }
}

function text(files: Record<string, Uint8Array>, name: string): string {
  const file = files[name];
  if (!file) throw new BodyshopError(`The workbook has no ${name}.`);
  return new TextDecoder().decode(file);
}

function resolve(base: string, target: string): string {
  return target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join(base, target));
}

function parse(xml: string, listen: (parser: SaxesParser) => void) {
  const parser = new SaxesParser();
  listen(parser);
  try {
    parser.write(xml).close();
  } catch {
    throw new BodyshopError("The workbook contains XML that cannot be read.");
  }
}

function sharedStrings(xml: string): string[] {
  const strings: string[] = [];
  let value = "";
  let inText = false;
  let inPhonetic = false;
  if (!xml) return strings;
  parse(xml, (parser) => {
    parser.on("opentag", (tag) => {
      if (tag.name === "si") value = "";
      if (tag.name === "rPh") inPhonetic = true;
      if (tag.name === "t" && !inPhonetic) inText = true;
    });
    parser.on("text", (chunk) => { if (inText) value += chunk; });
    parser.on("closetag", (tag) => {
      if (tag.name === "t") inText = false;
      if (tag.name === "rPh") inPhonetic = false;
      if (tag.name === "si") strings.push(value);
    });
  });
  return strings;
}

function cells(xml: string, strings: readonly string[]): Map<number, Map<string, Cell>> {
  const rows = new Map<number, Map<string, Cell>>();
  let current: { row: number; column: string; type: string; value: string; formula: boolean } | undefined;
  let capture = false;
  parse(xml, (parser) => {
    parser.on("opentag", (tag) => {
      if (tag.name === "c") {
        const reference = /^([A-Z]+)(\d+)$/.exec(String(tag.attributes.r ?? ""));
        current = reference ? { row: Number(reference[2]), column: reference[1]!, type: String(tag.attributes.t ?? "n"), value: "", formula: false } : undefined;
      }
      if (!current) return;
      if (tag.name === "f") current.formula = true;
      if (tag.name === "v" || tag.name === "t") capture = true;
    });
    parser.on("text", (chunk) => { if (capture && current) current.value += chunk; });
    parser.on("closetag", (tag) => {
      if (tag.name === "v" || tag.name === "t") capture = false;
      if (tag.name !== "c" || !current) return;
      const value = current.type === "s" ? strings[Number(current.value)] ?? "" : current.value;
      if (value !== "" || current.formula) {
        const row = rows.get(current.row) ?? new Map<string, Cell>();
        row.set(current.column, { value, type: current.type, formula: current.formula });
        rows.set(current.row, row);
      }
      current = undefined;
    });
  });
  return rows;
}

function comments(files: Record<string, Uint8Array>, sheetPath: string): Map<string, string> {
  const found = new Map<string, string>();
  const relations = posix.join(posix.dirname(sheetPath), "_rels", `${posix.basename(sheetPath)}.rels`);
  if (!files[relations]) return found;
  const targets: string[] = [];
  parse(text(files, relations), (parser) => parser.on("opentag", (tag) => {
    if (tag.name === "Relationship" && String(tag.attributes.Type ?? "").endsWith("/comments")) targets.push(resolve(posix.dirname(sheetPath), String(tag.attributes.Target ?? "")));
  }));
  for (const target of targets) {
    if (!files[target]) continue;
    let ref = "";
    let value = "";
    let inText = false;
    parse(text(files, target), (parser) => {
      parser.on("opentag", (tag) => {
        if (tag.name === "comment") { ref = String(tag.attributes.ref ?? ""); value = ""; }
        if (tag.name === "t") inText = true;
      });
      parser.on("text", (chunk) => { if (inText) value += chunk; });
      parser.on("closetag", (tag) => {
        if (tag.name === "t") inText = false;
        if (tag.name === "comment" && ref) found.set(ref, value.trim());
      });
    });
  }
  return found;
}
