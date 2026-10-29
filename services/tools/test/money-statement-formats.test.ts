import { describe, expect, it } from "vitest";
import { parseMoneyImport, REVOLUT_SAVINGS_FORMAT } from "../money/money-import-domain.js";
import { moneyWorkbookFixture } from "./money-workbook-fixture.js";

const savingsHeaders = ["Date", "Description", "Gross Interest Rate Earned", "Money in", "Money out", "Balance"];
const savingsRows = [
  ["8 Aug 2026", "Deposit to 'Instant Access Savings'", "", "€268.86", "", "€268.86"],
  ["8 Aug 2026", "Deposit to 'Instant Access Savings'", "", "€10.00", "", "€278.86"],
  ["9 Aug 2026", "Net Interest Paid to 'Instant Access Savings' for 9 Aug 2026", "2.00%", "€0.01", "", "€278.87"],
  ["10 Aug 2026", "Withdrawal from 'Instant Access Savings'", "", "", "€20.00", "€258.87"],
  ["11 Aug 2026", "Net Interest Paid to 'Instant Access Savings' for 11 Aug 2026", "2.00%", "€0.00", "", "€258.87"]
];

const layouts = [
  { name: "Revolut cash", headers: ["Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State", "Balance"], row: ["Transfer", "Current", "2026-08-09 12:00:00", "2026-08-09 12:00:00", "Own transfer", "10", "0", "EUR", "COMPLETED", "10"] },
  { name: "Revolut savings", headers: savingsHeaders, row: savingsRows[0]! },
  { name: "Revolut trading", headers: ["Date", "Ticker", "Type", "Quantity", "Price per share", "Total Amount", "Currency", "FX Rate"], row: ["2026-08-09T12:00:00.000Z", "VWCE", "BUY - MARKET", "0.5", "EUR 100", "EUR -50", "EUR", "1"] },
  { name: "portfolio", headers: "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code".split(","), row: "2026-08-09T12:00:00.000Z,2026-08-09,DEFAULT,TRADING,BUY,ETF,Global ETF,VWCE,0.5,100,-50,-1,,EUR,,,,Buy,buy-1,,,,".split(",") },
  { name: "balances", headers: ["Date", "Account", "Value", "Role", "Currency"], row: ["2026-08-09", "Cash", "420", "cash", "EUR"] }
];

describe("statement file formats", () => {
  it.each(layouts)("imports $name consistently from CSV, TSV, and Excel", ({ headers, row }) => {
    const expected = parseMoneyImport(delimited([headers, row], ","));
    const sources = [delimited([headers, row], "\t"), delimited([headers, row], ";"), moneyWorkbookFixture([headers, row]), moneyWorkbookFixture([headers, row], { sharedStrings: true })];
    for (const source of sources) {
      const parsed = parseMoneyImport(source);
      expect(parsed.format).toBe(expected.format);
      expect(parsed.transactions).toEqual(expected.transactions);
      expect(parsed.investmentEvents).toEqual(expected.investmentEvents);
      expect(parsed.balanceSnapshots).toEqual(expected.balanceSnapshots);
    }
  });

  it("reads numeric dates and amounts from Excel across account layouts", () => {
    for (const { headers, row, name } of layouts.filter(({ name }) => name !== "Revolut savings")) {
      const cells = row.map((value, index) => {
        const field = headers[index];
        if (["Date", "date", "datetime", "Started Date", "Completed Date"].includes(field!)) return { date: 46243.5 };
        return /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
      });
      const parsed = parseMoneyImport(moneyWorkbookFixture([headers, cells], { sharedStrings: true }));
      expect(parsed.transactions[0]?.localDate, name).toBe("2026-08-09");
      expect(parsed.transactions[0]?.amountMinor, name).toBe(parseMoneyImport(delimited([headers, row], ",")).transactions[0]?.amountMinor);
    }
  });

  it("supports the Excel 1904 date system", () => {
    const parsed = parseMoneyImport(moneyWorkbookFixture([layouts[4]!.headers, [{ date: 44781 }, "Cash", 420, "cash", "EUR"]], { date1904: true }));
    expect(parsed.transactions[0]?.localDate).toBe("2026-08-09");
  });

  it("deduplicates cash exports with numeric Excel dates and different decimal formatting", () => {
    const headers = layouts[0]!.headers;
    const row = ["Interest", "Deposit", "2026-08-09 5:08:51", "2026-08-09 5:08:51", "Interest paid", "0.010", "0.00", "EUR", "COMPLETED", "10.01"];
    const date = { date: 46243 + (5 * 3600 + 8 * 60 + 51) / 86400 };
    const csv = parseMoneyImport(delimited([headers, row], ","));
    const excel = parseMoneyImport(moneyWorkbookFixture([headers, ["Interest", "Deposit", date, date, "Interest paid", 0.01, 0, "EUR", "COMPLETED", 10.01]]));
    expect(excel.transactions).toEqual(csv.transactions);
    expect(excel.balanceSnapshots).toEqual(csv.balanceSnapshots);
    expect(csv.accounts[0]).toMatchObject({ externalRef: "revolut:cash:deposit:EUR", name: "Revolut Instant Access Savings" });
  });

  it.each([
    {
      name: "raw trading",
      headers: layouts[2]!.headers,
      row: layouts[2]!.row,
      amountColumn: 5,
      formattedAmount: "EUR -50.00",
      sourceKey: "5f4fe529c4a1bace77090878c1ef893ec3712c74b69c19373bb8d35663304da7",
      formattedSourceKey: "aba82128db2a0becf493073526de0b9abd9abfc292cce4cf92bd973ce756ab50"
    },
    {
      name: "id-less portfolio",
      headers: layouts[3]!.headers,
      row: layouts[3]!.row.map((value, index) => index === 18 ? "" : value),
      amountColumn: 10,
      formattedAmount: "-50.00",
      sourceKey: "c9f9ade14759dc5fe0f81f6f5d7ac995ea05ccef83683ccc7c7acb2f125ab5b7",
      formattedSourceKey: "079486c784c57999c295740d141976c5f95fe8c42994ac8afd0d20a1f760d631"
    }
  ])("preserves stored $name source keys without cash normalization", ({ headers, row, amountColumn, formattedAmount, sourceKey, formattedSourceKey }) => {
    const formattedRow = row.map((value, index) => index === amountColumn ? formattedAmount : value);
    for (const source of [delimited([headers, row, formattedRow], ","), moneyWorkbookFixture([headers, row, formattedRow])]) {
      const parsed = parseMoneyImport(source);
      expect(parsed.transactions.map((transaction) => transaction.sourceKey)).toEqual([sourceKey, formattedSourceKey]);
      expect(parsed.investmentEvents.map((event) => event.transactionSourceKey)).toEqual([sourceKey, formattedSourceKey]);
      expect(parsed.transactions.map((transaction) => transaction.amountMinor)).toEqual([-5000, -5000]);
    }
  });

  it("rejects workbook formulas, impossible Excel dates, and unknown statement layouts", () => {
    expect(() => parseMoneyImport(moneyWorkbookFixture([layouts[4]!.headers, ["2026-08-09", "Cash", { formula: "200+220", value: 420 }, "cash", "EUR"]]))).toThrow("Formula cells are not supported");
    expect(() => parseMoneyImport(moneyWorkbookFixture([layouts[4]!.headers, [{ date: 60 }, "Cash", 420, "cash", "EUR"]]))).toThrow("invalid Excel date");
    expect(() => parseMoneyImport(moneyWorkbookFixture([["Unknown", "Amount"], ["Payment", "10"]]))).toThrow("supported money export format");
    expect(() => parseMoneyImport(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toThrow("could not be opened");
  });
});

describe("Revolut savings statements", () => {
  it.each(["Sep", "Sept"])("reads the %s September date spelling", (month) => {
    const row = [`1 ${month} 2026`, "Deposit to 'Instant Access Savings'", "", "€10.00", "", "€10.00"];
    expect(parseMoneyImport(delimited([savingsHeaders, row], ",")).transactions[0]?.localDate).toBe("2026-09-01");
  });

  it("keeps transfers, interest, zero-cent rows, and daily closing balances", () => {
    const parsed = parseMoneyImport(delimited([savingsHeaders, ...savingsRows], ","));
    expect(parsed.format).toBe(REVOLUT_SAVINGS_FORMAT);
    expect(parsed.dateRange).toEqual({ from: "2026-08-08", to: "2026-08-11" });
    expect(parsed.transactions.map(({ amountMinor, flowKind, category }) => ({ amountMinor, flowKind, category }))).toEqual([
      { amountMinor: 26886, flowKind: "transfer", category: "transfer" },
      { amountMinor: 1000, flowKind: "transfer", category: "transfer" },
      { amountMinor: 1, flowKind: "investment_income", category: "income" },
      { amountMinor: -2000, flowKind: "transfer", category: "transfer" },
      { amountMinor: 0, flowKind: "investment_income", category: "income" }
    ]);
    expect(parsed.accounts).toEqual([expect.objectContaining({ externalRef: "revolut:cash:deposit:EUR", name: "Revolut Instant Access Savings", endingBalanceMinor: 25887, reconciliationMismatchCount: 0 })]);
    expect(parsed.balanceSnapshots[0]).toMatchObject({ date: "2026-08-08", valueMinor: 27886 });
    expect(parsed.warnings).toEqual([]);
  });

  it("deduplicates equivalent CSV and Excel rows despite encoded currency, dates, and rates", () => {
    const csv = parseMoneyImport(delimited([savingsHeaders, ...savingsRows.map((row) => row.map((value) => value.replaceAll("€", "â\u0082¬")))], ","));
    const excelRows = savingsRows.map((row, index) => row.map((value, column) => {
      if (column === 0) return { date: 46242 + Math.max(0, index - 1) };
      if (column === 2 && value) return 0.02;
      return value.replaceAll("€", "â_x0082_¬");
    }));
    const excel = parseMoneyImport(moneyWorkbookFixture([savingsHeaders, ...excelRows], { sharedStrings: true }));
    expect(excel.transactions).toEqual(csv.transactions);
    expect(new Set([...csv.transactions, ...excel.transactions].map(({ sourceKey }) => sourceKey)).size).toBe(5);
  });

  it("keeps distinct same-day deposits and warns about balance mismatches", () => {
    const row = ["8 Aug 2026", "Deposit to 'Instant Access Savings'", "", "€10.00", "", "€10.00"];
    const second = [...row.slice(0, 5), "€20.00"];
    const parsed = parseMoneyImport(delimited([savingsHeaders, row, second], ","));
    expect(new Set(parsed.transactions.map(({ sourceKey }) => sourceKey)).size).toBe(2);
    expect(parsed.balanceSnapshots[0]?.valueMinor).toBe(2000);
    expect(parseMoneyImport(delimited([savingsHeaders, row, [...second.slice(0, 5), "€30.00"]], ",")).warnings).toHaveLength(1);
  });

  it("accepts grouped EUR amounts and rejects foreign currencies, invalid dates, and ambiguous flows", () => {
    const row = ["8 Aug 2026", "Deposit to 'Instant Access Savings'", "", "€1,268.86", "", "EUR 1,268.86"];
    expect(parseMoneyImport(delimited([savingsHeaders, row], ",")).transactions[0]?.amountMinor).toBe(126886);
    const reject = (changes: Record<number, string>) => () => parseMoneyImport(delimited([savingsHeaders, row.map((value, index) => changes[index] ?? value)], ","));
    expect(reject({ 3: "$10.00" })).toThrow("invalid EUR Money in");
    expect(reject({ 0: "31 Feb 2026" })).toThrow("invalid Date");
    expect(reject({ 4: "€1.00" })).toThrow("money in or money out");
    expect(reject({ 1: "Unknown savings event" })).toThrow("unsupported savings transaction");
    expect(reject({ 2: "unknown" })).toThrow("invalid Gross Interest Rate");
    expect(reject({ 3: "€0.001" })).toThrow("fractional minor units");
  });
});

function delimited(rows: readonly (readonly string[])[], delimiter: string) {
  return Buffer.from(rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(delimiter)).join("\r\n"));
}
