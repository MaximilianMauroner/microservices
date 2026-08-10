import { unzipSync } from "fflate";
import { SaxesParser } from "saxes";

const WORKBOOK_PATH = "xl/workbook.xml";
const WORKSHEET_PATH = "xl/worksheets/sheet1.xml";
const WORKSHEET_NAME = "reportMovimenti";
const MAX_EXTRACTED_XML_BYTES = 20 * 1024 * 1024;

export type SparkasseWorkbookTransaction = Readonly<{
  sourceRow: number;
  bookingDate: string;
  valueDate: string;
  description: string;
  amount: string;
}>;

export type SparkasseWorkbook = Readonly<{
  accountHolder: string;
  iban: string;
  bankName: string;
  openingBalance: string;
  closingBalance: string;
  transactions: readonly SparkasseWorkbookTransaction[];
}>;

export class SparkasseWorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SparkasseWorkbookError";
  }
}

/** Reads the exact Sparkasse reportMovimenti workbook contract without retaining unrelated workbook assets. */
export function parseSparkasseWorkbook(bytes: Uint8Array): SparkasseWorkbook {
  if (!isZip(bytes)) throw new SparkasseWorkbookError("The file is not an XLSX workbook.");
  const wanted = new Set([WORKBOOK_PATH, WORKSHEET_PATH]);
  const seen = new Set<string>();
  let extractedBytes = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        if (!wanted.has(file.name)) return false;
        if (seen.has(file.name)) throw new SparkasseWorkbookError("The XLSX workbook contains duplicate core files.");
        seen.add(file.name);
        extractedBytes += file.originalSize;
        if (extractedBytes > MAX_EXTRACTED_XML_BYTES) throw new SparkasseWorkbookError("The XLSX workbook is too large after extraction.");
        return true;
      }
    });
  } catch (error) {
    if (error instanceof SparkasseWorkbookError) throw error;
    throw new SparkasseWorkbookError("The XLSX workbook could not be opened.");
  }
  const workbookXml = requiredXml(files, WORKBOOK_PATH);
  const sheetXml = requiredXml(files, WORKSHEET_PATH);
  const sheetNames = workbookSheetNames(workbookXml);
  if (sheetNames.length !== 1 || sheetNames[0] !== WORKSHEET_NAME) {
    throw new SparkasseWorkbookError("The workbook does not contain the expected Sparkasse movement sheet.");
  }
  return workbookRows(sheetXml);
}

type Cell = Readonly<{ type?: string; value: string }>;
type Row = Readonly<{ number: number; cells: ReadonlyMap<string, Cell> }>;

function workbookRows(xml: string): SparkasseWorkbook {
  const rows: Row[] = [];
  const rowNumbers = new Set<number>();
  let currentRow: { number: number; cells: Map<string, Cell> } | undefined;
  let currentCell: { column: string; type?: string; value: string } | undefined;
  let captureValue = false;
  const parser = xmlParser();
  parser.on("opentag", (tag) => {
    if (tag.name === "row") {
      const number = positiveInteger(tag.attributes.r);
      if (!number || currentRow) throw new SparkasseWorkbookError("The Sparkasse worksheet contains an invalid row.");
      currentRow = { number, cells: new Map() };
    } else if (tag.name === "c" && currentRow) {
      const reference = tag.attributes.r;
      const match = /^([A-Z]+)(\d+)$/.exec(reference ?? "");
      if (!match || Number(match[2]) !== currentRow.number || currentCell) throw new SparkasseWorkbookError("The Sparkasse worksheet contains an invalid cell reference.");
      currentCell = { column: match[1]!, ...(tag.attributes.t ? { type: tag.attributes.t } : {}), value: "" };
    } else if ((tag.name === "t" || tag.name === "v") && currentCell) {
      captureValue = true;
    } else if (tag.name === "f") {
      throw new SparkasseWorkbookError("Formula cells are not supported in Sparkasse imports.");
    }
  });
  parser.on("text", (text) => {
    if (captureValue && currentCell) currentCell.value += text;
  });
  parser.on("closetag", (tag) => {
    if (tag.name === "t" || tag.name === "v") {
      captureValue = false;
    } else if (tag.name === "c" && currentCell && currentRow) {
      if (currentRow.cells.has(currentCell.column)) throw new SparkasseWorkbookError("The Sparkasse worksheet contains a duplicate cell.");
      if (currentCell.type && currentCell.type !== "inlineStr" && currentCell.type !== "n") {
        throw new SparkasseWorkbookError("The Sparkasse worksheet uses an unsupported cell type.");
      }
      currentRow.cells.set(currentCell.column, { ...(currentCell.type ? { type: currentCell.type } : {}), value: currentCell.value });
      currentCell = undefined;
    } else if (tag.name === "row" && currentRow) {
      if (rowNumbers.has(currentRow.number)) throw new SparkasseWorkbookError("The Sparkasse worksheet contains a duplicate row.");
      rowNumbers.add(currentRow.number);
      rows.push({ number: currentRow.number, cells: currentRow.cells });
      currentRow = undefined;
    }
  });
  parseXml(parser, xml);
  const byNumber = new Map(rows.map((row) => [row.number, row]));
  assertText(byNumber, 3, "A", "Auszug");
  assertText(byNumber, 3, "B", "Bewegungen");
  const accountHolder = requiredCell(byNumber, 5, "A").value.trim();
  assertText(byNumber, 6, "A", "IBAN");
  assertText(byNumber, 9, "A", "Bank Name");
  assertText(byNumber, 13, "A", "Anfangssaldo");
  assertText(byNumber, 14, "A", "Endsaldo");
  assertText(byNumber, 16, "A", "Buchungsdatum");
  assertText(byNumber, 16, "B", "Wertstellungsdatum");
  assertText(byNumber, 16, "C", "Beschreibung");
  assertText(byNumber, 16, "D", "Betrag EUR");
  const iban = requiredCell(byNumber, 6, "B").value.trim();
  const bankName = requiredCell(byNumber, 9, "B").value.trim();
  const openingBalance = numericCell(byNumber, 13, "B");
  const closingBalance = numericCell(byNumber, 14, "B");
  if (!accountHolder || !iban || bankName !== "Südtiroler Sparkasse") throw new SparkasseWorkbookError("The workbook account metadata is invalid.");
  const transactions: SparkasseWorkbookTransaction[] = [];
  for (let sourceRow = 17; ; sourceRow += 1) {
    const row = byNumber.get(sourceRow);
    if (!row || !row.cells.get("A")?.value) break;
    transactions.push({
      sourceRow,
      bookingDate: excelDate(numericCell(byNumber, sourceRow, "A"), sourceRow, "Buchungsdatum"),
      valueDate: excelDate(numericCell(byNumber, sourceRow, "B"), sourceRow, "Wertstellungsdatum"),
      description: requiredCell(byNumber, sourceRow, "C").value,
      amount: numericCell(byNumber, sourceRow, "D")
    });
  }
  if (!transactions.length) throw new SparkasseWorkbookError("The Sparkasse workbook contains no transactions.");
  return { accountHolder, iban, bankName, openingBalance, closingBalance, transactions };
}

function workbookSheetNames(xml: string) {
  const names: string[] = [];
  const parser = xmlParser();
  parser.on("opentag", (tag) => {
    if (tag.name === "sheet" && tag.attributes.name) names.push(tag.attributes.name);
  });
  parseXml(parser, xml);
  return names;
}

function xmlParser() {
  const parser = new SaxesParser();
  parser.on("doctype", () => { throw new SparkasseWorkbookError("Document types are not supported in XLSX XML."); });
  parser.on("error", () => { throw new SparkasseWorkbookError("The XLSX workbook contains invalid XML."); });
  return parser;
}

function parseXml(parser: SaxesParser, xml: string) {
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof SparkasseWorkbookError) throw error;
    throw new SparkasseWorkbookError("The XLSX workbook contains invalid XML.");
  }
}

function requiredXml(files: Record<string, Uint8Array>, path: string) {
  const bytes = files[path];
  if (!bytes) throw new SparkasseWorkbookError("The XLSX workbook is missing a core file.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SparkasseWorkbookError("The XLSX workbook XML must use UTF-8 encoding.");
  }
}

function requiredCell(rows: ReadonlyMap<number, Row>, row: number, column: string) {
  const cell = rows.get(row)?.cells.get(column);
  if (!cell) throw new SparkasseWorkbookError(`The Sparkasse worksheet is missing cell ${column}${row}.`);
  return cell;
}

function assertText(rows: ReadonlyMap<number, Row>, row: number, column: string, expected: string) {
  if (requiredCell(rows, row, column).value !== expected) throw new SparkasseWorkbookError("The Sparkasse worksheet layout is not supported.");
}

function numericCell(rows: ReadonlyMap<number, Row>, row: number, column: string) {
  const cell = requiredCell(rows, row, column);
  if ((cell.type && cell.type !== "n") || !/^-?\d+(?:\.\d+)?$/.test(cell.value)) {
    throw new SparkasseWorkbookError(`The Sparkasse worksheet has an invalid number in cell ${column}${row}.`);
  }
  return cell.value;
}

function excelDate(value: string, sourceRow: number, field: string) {
  if (!/^\d+(?:\.0+)?$/.test(value)) throw new SparkasseWorkbookError(`Row ${sourceRow} has an invalid ${field}.`);
  const serial = Number(value);
  if (!Number.isSafeInteger(serial) || serial < 1 || serial > 2_958_465) throw new SparkasseWorkbookError(`Row ${sourceRow} has an invalid ${field}.`);
  const date = new Date((serial - 25_569) * 86_400_000);
  if (Number.isNaN(date.getTime())) throw new SparkasseWorkbookError(`Row ${sourceRow} has an invalid ${field}.`);
  return date.toISOString().slice(0, 10);
}

function positiveInteger(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isZip(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
