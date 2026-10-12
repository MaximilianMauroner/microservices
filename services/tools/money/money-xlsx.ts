import { posix } from "node:path";
import { unzipSync } from "fflate";
import { SaxesParser } from "saxes";

const MAX_EXTRACTED_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 100_016;
const MAX_COLUMNS = 64;
const WORKBOOK = "xl/workbook.xml";
const RELATIONSHIPS = "xl/_rels/workbook.xml.rels";

export class MoneyWorkbookError extends Error {
  constructor(message: string) { super(message); this.name = "MoneyWorkbookError"; }
}

/** Reads statement cells only. Images, links, formulas, and external workbook assets are not imported. */
export function parseMoneyWorkbook(bytes: Uint8Array): string[][] {
  const files = extractStatementFiles(bytes);
  const sheets: { name: string; relationship?: string }[] = [];
  let date1904 = false;
  parseXml(requiredXml(files, WORKBOOK), (parser) => {
    parser.on("opentag", (tag) => {
      if (tag.name === "sheet") sheets.push({ name: tag.attributes.name ?? "", relationship: tag.attributes["r:id"] });
      if (tag.name === "workbookPr") date1904 = tag.attributes.date1904 === "1" || tag.attributes.date1904 === "true";
    });
  });
  if (sheets.length !== 1) throw new MoneyWorkbookError("Import a workbook with one statement worksheet.");
  const path = worksheetPath(files, sheets[0]!.relationship);
  const strings = sharedStrings(optionalXml(files, "xl/sharedStrings.xml"));
  const dateStyles = workbookDateStyles(optionalXml(files, "xl/styles.xml"));
  return worksheetRows(requiredXml(files, path), strings, dateStyles, date1904);
}

function extractStatementFiles(bytes: Uint8Array) {
  const seen = new Set<string>();
  let extractedBytes = 0;
  try {
    return unzipSync(bytes, { filter(file) {
      if (![WORKBOOK, RELATIONSHIPS, "xl/sharedStrings.xml", "xl/styles.xml"].includes(file.name) && !/^xl\/worksheets\/[^/]+\.xml$/.test(file.name)) return false;
      if (seen.has(file.name)) throw new MoneyWorkbookError("The XLSX workbook contains duplicate core files.");
      seen.add(file.name);
      extractedBytes += file.originalSize;
      if (extractedBytes > MAX_EXTRACTED_BYTES) throw new MoneyWorkbookError("The XLSX workbook is too large after extraction.");
      return true;
    } });
  } catch (error) {
    if (error instanceof MoneyWorkbookError) throw error;
    throw new MoneyWorkbookError("The XLSX workbook could not be opened.");
  }
}

function worksheetPath(files: Record<string, Uint8Array>, relationship: string | undefined) {
  // Earlier accepted Sparkasse workbooks need not include a relationship file.
  if (!files[RELATIONSHIPS] && !relationship) return "xl/worksheets/sheet1.xml";
  let path: string | undefined;
  parseXml(requiredXml(files, RELATIONSHIPS), (parser) => {
    parser.on("opentag", (tag) => {
      if (tag.name !== "Relationship" || tag.attributes.Id !== relationship) return;
      if (tag.attributes.TargetMode === "External" || !tag.attributes.Type?.endsWith("/worksheet")) throw new MoneyWorkbookError("External worksheets are not supported.");
      path = posix.normalize(posix.join("xl", tag.attributes.Target ?? ""));
      if (tag.attributes.Target?.startsWith("/")) path = tag.attributes.Target.slice(1);
    });
  });
  if (!path || !/^xl\/worksheets\/[^/]+\.xml$/.test(path)) throw new MoneyWorkbookError("The XLSX workbook has an invalid worksheet relationship.");
  return path;
}

function sharedStrings(xml: string | undefined) {
  const strings: string[] = [];
  if (!xml) return strings;
  let value = "";
  let capture = false;
  parseXml(xml, (parser) => {
    parser.on("opentag", (tag) => {
      if (tag.name === "si") value = "";
      if (tag.name === "t") capture = true;
    });
    parser.on("text", (text) => { if (capture) value += text; });
    parser.on("closetag", (tag) => {
      if (tag.name === "t") capture = false;
      if (tag.name === "si") strings.push(decodeExcelText(value));
    });
  });
  return strings;
}

function workbookDateStyles(xml: string | undefined) {
  const formats = new Map<number, string>();
  const styles: boolean[] = [];
  if (!xml) return styles;
  let inCellStyles = false;
  parseXml(xml, (parser) => {
    parser.on("opentag", (tag) => {
      if (tag.name === "numFmt") formats.set(Number(tag.attributes.numFmtId), tag.attributes.formatCode ?? "");
      if (tag.name === "cellXfs") inCellStyles = true;
      if (tag.name !== "xf" || !inCellStyles) return;
      const id = Number(tag.attributes.numFmtId);
      const code = (formats.get(id) ?? "").replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
      styles.push((id >= 14 && id <= 22) || /[ydhs]/i.test(code));
    });
    parser.on("closetag", (tag) => { if (tag.name === "cellXfs") inCellStyles = false; });
  });
  return styles;
}

type WorksheetCell = { column: number; type: string; style: number; value: string };

function worksheetRows(xml: string, strings: readonly string[], dateStyles: readonly boolean[], date1904: boolean) {
  const rows: string[][] = [];
  const seenRows = new Set<number>();
  let rowNumber = 0;
  let row: string[] | undefined;
  let cell: WorksheetCell | undefined;
  let capture = false;
  let width = 0;
  parseXml(xml, (parser) => {
    parser.on("opentag", (tag) => {
      if (tag.name === "row") {
        rowNumber = Number(tag.attributes.r);
        if (row || !Number.isSafeInteger(rowNumber) || rowNumber < 1 || rowNumber > MAX_ROWS || seenRows.has(rowNumber)) throw new MoneyWorkbookError("The worksheet contains an invalid or duplicate row.");
        seenRows.add(rowNumber);
        row = [];
      }
      if (tag.name === "c" && row) {
        const reference = /^([A-Z]+)(\d+)$/.exec(tag.attributes.r ?? "");
        if (cell || !reference || Number(reference[2]) !== rowNumber) throw new MoneyWorkbookError("The worksheet contains an invalid cell reference.");
        const column = columnNumber(reference[1]!);
        if (column >= MAX_COLUMNS || row[column] !== undefined) throw new MoneyWorkbookError("The worksheet contains an invalid or duplicate column.");
        cell = { column, type: tag.attributes.t ?? "n", style: Number(tag.attributes.s ?? 0), value: "" };
      }
      if ((tag.name === "t" || tag.name === "v") && cell) capture = true;
      if (tag.name === "f") throw new MoneyWorkbookError("Formula cells are not supported in money imports.");
    });
    parser.on("text", (text) => { if (capture && cell) cell.value += text; });
    parser.on("closetag", (tag) => {
      if (tag.name === "t" || tag.name === "v") capture = false;
      if (tag.name === "c" && cell && row) {
        row[cell.column] = cellValue(cell, strings, dateStyles, date1904);
        width = Math.max(width, cell.column + 1);
        cell = undefined;
      }
      if (tag.name === "row" && row) { rows[rowNumber - 1] = row; row = undefined; }
    });
  });
  return Array.from({ length: rows.length }, (_, index) => Array.from({ length: width }, (_, column) => rows[index]?.[column] ?? ""));
}

function cellValue(cell: WorksheetCell, strings: readonly string[], dateStyles: readonly boolean[], date1904: boolean) {
  if (cell.type === "s") {
    const index = Number(cell.value);
    if (!/^\d+$/.test(cell.value) || !Number.isSafeInteger(index) || strings[index] === undefined) throw new MoneyWorkbookError("The worksheet contains an invalid shared string.");
    return strings[index];
  }
  if (cell.type === "inlineStr" || cell.type === "str") return decodeExcelText(cell.value);
  if (cell.type === "d") {
    if (!/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(cell.value)) throw new MoneyWorkbookError("The worksheet contains an invalid date cell.");
    return cell.value;
  }
  if (cell.type !== "n") throw new MoneyWorkbookError("The worksheet uses an unsupported cell type.");
  if (cell.value && dateStyles[cell.style]) return excelTimestamp(cell.value, date1904);
  return cell.value;
}

export function excelTimestamp(value: string, date1904 = false) {
  const serial = Number(value);
  if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(serial) || serial < 1 || serial > 2_958_465 || (!date1904 && Math.floor(serial) === 60)) throw new MoneyWorkbookError("The worksheet contains an invalid Excel date.");
  const offset = date1904 ? 24_107 : serial < 60 ? 25_568 : 25_569;
  return new Date(Math.round((serial - offset) * 86_400) * 1000).toISOString();
}

function columnNumber(value: string) {
  let number = 0;
  for (const letter of value) number = number * 26 + letter.charCodeAt(0) - 64;
  return number - 1;
}

function decodeExcelText(value: string) { return value.replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))); }

function parseXml(xml: string, configure: (parser: SaxesParser) => void) {
  const parser = new SaxesParser();
  parser.on("doctype", () => { throw new MoneyWorkbookError("Document types are not supported in XLSX XML."); });
  parser.on("error", () => { throw new MoneyWorkbookError("The XLSX workbook contains invalid XML."); });
  configure(parser);
  parser.write(xml).close();
}

function optionalXml(files: Record<string, Uint8Array>, path: string) {
  const bytes = files[path];
  if (!bytes) return undefined;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new MoneyWorkbookError("The XLSX workbook XML must use UTF-8 encoding."); }
}

function requiredXml(files: Record<string, Uint8Array>, path: string) {
  const xml = optionalXml(files, path);
  if (xml === undefined) throw new MoneyWorkbookError("The XLSX workbook is missing a core file.");
  return xml;
}
