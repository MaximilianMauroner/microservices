import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseMoneyImport, SPARKASSE_CASH_FORMAT } from "../money/money-import-domain.js";

describe("Sparkasse XLSX parser", () => {
  it("normalizes movements, costs, private account data, and reconstructed balances", () => {
    const parsed = parseMoneyImport(workbook());

    expect(parsed.format).toBe(SPARKASSE_CASH_FORMAT);
    expect(parsed.rowCount).toBe(4);
    expect(parsed.dateRange).toEqual({ from: "2024-08-14", to: "2024-08-17" });
    expect(parsed.accounts).toEqual([expect.objectContaining({
      name: "Sparkasse · 3456",
      endingBalanceMinor: 12_750,
      reconciliationMismatchCount: 0
    })]);
    expect(parsed.transactions.map(({ sourceRow, flowKind, amountMinor, feeMinor, taxMinor, balanceAfterMinor }) => ({ sourceRow, flowKind, amountMinor, feeMinor, taxMinor, balanceAfterMinor }))).toEqual([
      { sourceRow: 20, flowKind: "income", amountMinor: 5_000, feeMinor: 0, taxMinor: 0, balanceAfterMinor: 15_000 },
      { sourceRow: 19, flowKind: "spend", amountMinor: -2_000, feeMinor: 0, taxMinor: 0, balanceAfterMinor: 13_000 },
      { sourceRow: 18, flowKind: "fee", amountMinor: 0, feeMinor: 200, taxMinor: 0, balanceAfterMinor: 12_800 },
      { sourceRow: 17, flowKind: "tax", amountMinor: 0, feeMinor: 0, taxMinor: 50, balanceAfterMinor: 12_750 }
    ]);
    expect(parsed.transactions[1]?.description).toContain("[account]");
    expect(JSON.stringify(parsed)).not.toContain("IT60 X054 2811 1010 0000 0012 3456");
    expect(parsed.balanceSnapshots.at(-1)).toEqual(expect.objectContaining({ date: "2024-08-17", valueMinor: 12_750 }));
  });

  it("fails closed when the Sparkasse layout changes or balances do not reconcile", () => {
    expect(() => parseMoneyImport(workbook({ header: "Dettagli" }))).toThrow("layout is not supported");
    expect(() => parseMoneyImport(workbook({ closingBalance: "128" }))).toThrow("do not reconcile");
  });

  it("rejects formulas in imported cells", () => {
    expect(() => parseMoneyImport(workbook({ formula: true }))).toThrow("Formula cells are not supported");
  });

  it("fails closed on unknown Sparkasse transaction types", () => {
    expect(() => parseMoneyImport(workbook({ incomeType: "UNBEKANNTE BUCHUNG" }))).toThrow("unsupported Sparkasse transaction type");
  });

  it("distinguishes own-account transfers from third-party bank spending", () => {
    const ownAccount = parseMoneyImport(workbook({ spendDescription: "HOMEBANKINGUEBERWEISUNG\nMax Example IBAN Beg.: IT00 A000 0000 0000 0000 0000 000" }));
    const thirdParty = parseMoneyImport(workbook({ spendDescription: "HOMEBANKINGUEBERWEISUNG\nExample University IBAN Beg.: IT00 A000 0000 0000 0000 0000 000" }));

    expect(ownAccount.transactions.find(({ sourceRow }) => sourceRow === 19)?.flowKind).toBe("transfer");
    expect(thirdParty.transactions.find(({ sourceRow }) => sourceRow === 19)?.flowKind).toBe("spend");
  });
});

function workbook(options: Readonly<{ header?: string; closingBalance?: string; formula?: boolean; incomeType?: string; spendDescription?: string }> = {}) {
  const number = (reference: string, value: string) => `<c r="${reference}" t="n"><v>${value}</v></c>`;
  const text = (reference: string, value: string) => `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const transaction = (row: number, date: string, description: string, amount: string) => `<row r="${row}">${number(`A${row}`, date)}${number(`B${row}`, date)}${text(`C${row}`, description)}${number(`D${row}`, amount)}</row>`;
  const incomeAmount = options.formula ? `<c r="D20" t="n"><f>25+25</f><v>50</v></c>` : number("D20", "50");
  const sheet = `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
      <row r="3">${text("A3", "Auszug")}${text("B3", "Bewegungen")}</row>
      <row r="5">${text("A5", "EXAMPLE MAX")}</row>
      <row r="6">${text("A6", "IBAN")}${text("B6", "IT60 X054 2811 1010 0000 0012 3456")}</row>
      <row r="9">${text("A9", "Bank Name")}${text("B9", "Südtiroler Sparkasse")}</row>
      <row r="13">${text("A13", "Anfangssaldo")}${number("B13", "100")}${text("C13", "EUR")}</row>
      <row r="14">${text("A14", "Endsaldo")}${number("B14", options.closingBalance ?? "127.5")}${text("C14", "EUR")}</row>
      <row r="16">${text("A16", "Buchungsdatum")}${text("B16", "Wertstellungsdatum")}${text("C16", options.header ?? "Beschreibung")}${text("D16", "Betrag EUR")}</row>
      ${transaction(17, "45521", "STEMPELSTEUER\n", "-0.5")}
      ${transaction(18, "45520", "GEBUEHREN\n", "-2")}
      ${transaction(19, "45519", options.spendDescription ?? "LASTSCHRIFT\nZahlung an IT60 X054 2811 1010 0000 0012 3456", "-20")}
      <row r="20">${number("A20", "45518")}${number("B20", "45518")}${text("C20", `${options.incomeType ?? "BEZUEGE"}\nSalary`)}${incomeAmount}</row>
    </sheetData></worksheet>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="reportMovimenti" sheetId="1"/></sheets></workbook>`;
  return zipSync({
    "xl/workbook.xml": strToU8(workbookXml),
    "xl/worksheets/sheet1.xml": strToU8(sheet)
  });
}
