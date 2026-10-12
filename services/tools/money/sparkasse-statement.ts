import { excelTimestamp } from "./money-xlsx.js";

export type SparkasseStatementTransaction = Readonly<{
  sourceRow: number;
  bookingDate: string;
  valueDate: string;
  description: string;
  amount: string;
}>;

export class SparkasseStatementError extends Error {
  constructor(message: string) { super(message); this.name = "SparkasseStatementError"; }
}

/** Parses the Sparkasse movement report after decoding its file container. */
export function parseSparkasseStatement(rows: readonly string[][]) {
  assertText(rows, 3, 0, "Auszug");
  assertText(rows, 3, 1, "Bewegungen");
  const accountHolder = requiredCell(rows, 5, 0).trim();
  assertText(rows, 6, 0, "IBAN");
  assertText(rows, 9, 0, "Bank Name");
  assertText(rows, 13, 0, "Anfangssaldo");
  assertText(rows, 14, 0, "Endsaldo");
  assertText(rows, 16, 0, "Buchungsdatum");
  assertText(rows, 16, 1, "Wertstellungsdatum");
  assertText(rows, 16, 2, "Beschreibung");
  assertText(rows, 16, 3, "Betrag EUR");
  const iban = requiredCell(rows, 6, 1).trim();
  const bankName = requiredCell(rows, 9, 1).trim();
  const openingBalance = numericCell(rows, 13, 1);
  const closingBalance = numericCell(rows, 14, 1);
  if (!accountHolder || !iban || bankName !== "Südtiroler Sparkasse") throw new SparkasseStatementError("The workbook account metadata is invalid.");
  const transactions: SparkasseStatementTransaction[] = [];
  for (let sourceRow = 17; sourceRow <= rows.length; sourceRow += 1) {
    if (!rows[sourceRow - 1]?.some((value) => value.trim())) continue;
    transactions.push({
      sourceRow,
      bookingDate: statementDate(requiredCell(rows, sourceRow, 0), sourceRow, "Buchungsdatum"),
      valueDate: statementDate(requiredCell(rows, sourceRow, 1), sourceRow, "Wertstellungsdatum"),
      description: requiredCell(rows, sourceRow, 2),
      amount: numericCell(rows, sourceRow, 3)
    });
  }
  if (!transactions.length) throw new SparkasseStatementError("The Sparkasse statement contains no transactions.");
  return { accountHolder, iban, bankName, openingBalance, closingBalance, transactions };
}

function requiredCell(rows: readonly string[][], row: number, column: number) {
  const value = rows[row - 1]?.[column];
  if (value === undefined || value === "") throw new SparkasseStatementError(`The Sparkasse statement is missing cell ${String.fromCharCode(65 + column)}${row}.`);
  return value;
}

function assertText(rows: readonly string[][], row: number, column: number, expected: string) {
  if (requiredCell(rows, row, column) !== expected) throw new SparkasseStatementError("The Sparkasse statement layout is not supported.");
}

function numericCell(rows: readonly string[][], row: number, column: number) {
  const value = requiredCell(rows, row, column);
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new SparkasseStatementError(`The Sparkasse statement has an invalid number in cell ${String.fromCharCode(65 + column)}${row}.`);
  return value;
}

function statementDate(value: string, sourceRow: number, field: string) {
  if (/^\d+(?:\.0+)?$/.test(value)) return excelTimestamp(value).slice(0, 10);
  const date = value.slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}(?:T00:00:00\.000Z)?$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new SparkasseStatementError(`Row ${sourceRow} has an invalid ${field}.`);
  return date;
}
