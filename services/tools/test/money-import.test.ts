import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  MoneyImportValidationError,
  MONEY_BALANCE_SNAPSHOT_FORMAT,
  PORTFOLIO_TRANSACTION_FORMAT,
  REVOLUT_CASH_FORMAT,
  REVOLUT_TRADING_FORMAT,
  categorizeDescription,
  parseMoneyImport
} from "../money/money-import-domain.js";
import { MoneyImportService } from "../money/money-import-service.js";
import { previewMoneyImport, updateMoneyCategory, updateMoneyTransfer } from "../money/money-route-handlers.js";
import type {
  MoneyImportCommitInput,
  MoneyImportReceipt,
  MoneyLedgerSnapshot,
  MoneyRepository
} from "../money/money-repository.js";
import type { PlatformRouteInput } from "../src/route-handlers.js";

const header = "Type\tProduct\tStarted Date\tCompleted Date\tDescription\tAmount\tFee\tCurrency\tState\tBalance";

describe("Revolut cash statement parser", () => {
  it("infers common merchant and MCC categories from the supplied export families", () => {
    const cases = [
      ["BILLA", undefined, "groceries"], ["SÃ¼dtiroler Milch", undefined, "groceries"],
      ["Lieferando", undefined, "dining"], ["CafÃ© Jelinek", undefined, "dining"],
      ["ÃBB", undefined, "transport"], ["ENIO", undefined, "transport"],
      ["Apotheke Schwenk", undefined, "health"], ["Booking.com", undefined, "travel"],
      ["OpenAI", undefined, "subscriptions"], ["JetBrains", undefined, "subscriptions"],
      ["Steam", undefined, "entertainment"], ["Amazon", undefined, "shopping"],
      ["Payment", "5411", "groceries"], ["Payment", "5732", "shopping"],
      ["Unknown person", undefined, "uncategorized"]
    ] as const;
    for (const [description, mcc, category] of cases) expect(categorizeDescription(description, mcc)).toBe(category);
  });

  it("normalizes exact amounts, statuses, flow kinds, and Berlin timestamps", () => {
    const parsed = statement([
      "Transfer\tCurrent\t2026-08-09 5:08:51\t2026-08-09 5:08:51\tFrom own account\t20\t0\tEUR\tCOMPLETED\t20",
      "Card Payment\tCurrent\t2026-08-09 7:10:00\t2026-08-09 7:11:00\tCoffee\t-3.5\t0.1\tEUR\tCOMPLETED\t16.4",
      "Card Payment\tCurrent\t2026-08-09 8:00:00\t2026-08-09 8:00:00\tReverted purchase\t-5\t0\tEUR\tREVERTED\t",
    ]);

    expect(parsed.format).toBe(REVOLUT_CASH_FORMAT);
    expect(parsed.rowCount).toBe(3);
    expect(parsed.dateRange).toEqual({ from: "2026-08-09", to: "2026-08-09" });
    expect(parsed.transactions[0]).toMatchObject({
      occurredAt: "2026-08-09T03:08:51.000Z",
      amountMinor: 2_000,
      feeMinor: 0,
      balanceAfterMinor: 2_000,
      status: "completed",
      flowKind: "transfer"
    });
    expect(parsed.transactions[1]).toMatchObject({
      amountMinor: -350,
      feeMinor: 10,
      balanceAfterMinor: 1_640,
      flowKind: "spend",
      category: "dining"
    });
    expect(parsed.transactions[2]).toMatchObject({ status: "reverted" });
    expect(parsed.accounts).toEqual([expect.objectContaining({
      name: "Revolut Current",
      rowCount: 3,
      completedCount: 2,
      revertedCount: 1,
      endingBalanceMinor: 1_640,
      reconciliationMismatchCount: 0
    })]);
  });

  it("treats legal-entity migrations as balance adjustments", () => {
    const parsed = statement([
      "Transfer\tPocket\t2021-12-09 16:44:13\t2021-12-09 16:44:13\tBalance migration to another region or legal entity\t-54.96\t0\tEUR\tCOMPLETED\t0",
      "Transfer\tPocket\t2023-12-18 15:52:27\t2023-12-18 15:52:27\tClosing transaction\t0\t0\tEUR\tCOMPLETED\t0"
    ]);

    expect(parsed.transactions.map(({ flowKind }) => flowKind)).toEqual(["balance_adjustment", "balance_adjustment"]);
    expect(parsed.accounts[0]?.reconciliationMismatchCount).toBe(0);
  });

  it("fingerprints rows independently from their source row number", () => {
    const row = "Interest\tDeposit\t2026-08-09 5:08:51\t2026-08-09 5:08:51\tInterest paid\t0.01\t0\tEUR\tCOMPLETED\t10.01";
    const first = statement([row]);
    const shifted = statement([
      "Transfer\tCurrent\t2026-08-08 5:08:51\t2026-08-08 5:08:51\tTop up\t10\t0\tEUR\tCOMPLETED\t10",
      row
    ]);

    expect(first.transactions[0]?.sourceKey).toBe(shifted.transactions[1]?.sourceKey);
  });

  it("fails closed on changed headers and unknown transaction types", () => {
    expect(() => parseMoneyImport(Buffer.from(header.replace("Balance", "Running Balance")))).toThrowError(MoneyImportValidationError);
    expect(() => statement(["Mystery\tCurrent\t2026-08-09 5:08:51\t2026-08-09 5:08:51\tUnknown\t1\t0\tEUR\tCOMPLETED\t1"])).toThrow("unsupported transaction type");
  });

  it("rejects non-EUR cash and impossible or nonexistent Berlin dates", () => {
    expect(() => statement(["Transfer\tCurrent\t2026-08-09 5:08:51\t2026-08-09 5:08:51\tTop up\t10\t0\tUSD\tCOMPLETED\t10"])).toThrow("currently supports EUR only");
    expect(() => statement(["Transfer\tCurrent\t2026-02-30 5:08:51\t2026-02-30 5:08:51\tTop up\t10\t0\tEUR\tCOMPLETED\t10"])).toThrow("invalid Started Date");
    expect(() => statement(["Transfer\tCurrent\t2026-03-29 2:30:00\t2026-03-29 2:30:00\tTop up\t10\t0\tEUR\tCOMPLETED\t10"])).toThrow("nonexistent Europe/Berlin time");
  });

  it("uses source sequence when equal timestamps contain multiple balances", () => {
    const parsed = statement([
      "Transfer\tCurrent\t2026-08-09 5:08:51\t2026-08-09 5:08:51\tFirst\t10\t0\tEUR\tCOMPLETED\t10",
      "Transfer\tCurrent\t2026-08-09 5:08:51\t2026-08-09 5:08:51\tSecond\t5\t0\tEUR\tCOMPLETED\t15"
    ]);
    expect(parsed.balanceSnapshots).toEqual([expect.objectContaining({ valueMinor: 1_500, sourceRow: 3 })]);
  });
});

describe("investment export parsers", () => {
  it("normalizes Revolut trading rows into ledger and exact investment events", () => {
    const bytes = Buffer.from([
      "Date\tTicker\tType\tQuantity\tPrice per share\tTotal Amount\tCurrency\tFX Rate",
      "2026-08-09T03:08:51.000Z\tVWCE\tBUY - MARKET\t0.25\tUSD 120.5\tUSD 30.13\tUSD\t2",
      "2026-08-10T03:08:51.000Z\tVWCE\tDIVIDEND\t\t\tEUR 1.2\tEUR\t1"
    ].join("\r\n"));

    const parsed = parseMoneyImport(bytes);

    expect(parsed.format).toBe(REVOLUT_TRADING_FORMAT);
    expect(parsed.transactions[0]).toMatchObject({ flowKind: "trade", amountMinor: -3_013, baseAmountMinor: -1_507, baseCurrency: "EUR", category: "investments" });
    expect(parsed.investmentEvents[0]).toMatchObject({ eventKind: "buy", symbol: "VWCE", quantity: "0.25", unitPrice: "120.5" });
    expect(parsed.investmentEvents[1]).toMatchObject({ eventKind: "dividend" });
  });

  it("rejects investment decimals outside numeric(30,12), non-positive FX, and mismatched price currencies", () => {
    const tradingHeader = "Date\tTicker\tType\tQuantity\tPrice per share\tTotal Amount\tCurrency\tFX Rate";
    const parseTrading = (row: string) => parseMoneyImport(Buffer.from(`${tradingHeader}\r\n${row}\r\n`));
    expect(() => parseTrading("2026-08-09T03:08:51.000Z\tVWCE\tBUY - MARKET\t1234567890123456789\tEUR 1\tEUR 1\tEUR\t1")).toThrow("at most 18 integral");
    expect(() => parseTrading("2026-08-09T03:08:51.000Z\tVWCE\tBUY - MARKET\t0.1234567890123\tEUR 1\tEUR 1\tEUR\t1")).toThrow("at most 18 integral");
    expect(() => parseTrading("2026-08-09T03:08:51.000Z\tVWCE\tBUY - MARKET\t1\tUSD 1\tEUR 1\tEUR\t1")).toThrow("invalid Price per share");
    expect(() => parseTrading("2026-08-09T03:08:51.000Z\tVWCE\tBUY - MARKET\t1\tUSD 1\tUSD 1\tUSD\t0")).toThrow("invalid FX Rate");
    expect(() => parseTrading("2026-08-09T03:08:51.000Z\tVWCE\tSELL - MARKET\t-1\tEUR 1\tEUR 1\tEUR\t1")).toThrow("positive Quantity");
  });

  it("rejects oversized UTF-8 indexed identities during preview", () => {
    const oversized = "é".repeat(257);
    expect(() => parseMoneyImport(Buffer.from(`Type\tProduct\tStarted Date\tCompleted Date\tDescription\tAmount\tFee\tCurrency\tState\tBalance\r\nCard Payment\t${oversized}\t2026-08-01 12:00:00\t2026-08-01 12:00:00\tTest\t-1\t0\tEUR\tCOMPLETED\t1\r\n`))).toThrow("512 UTF-8 bytes");
    expect(() => parseMoneyImport(Buffer.from(`Date\tTicker\tType\tQuantity\tPrice per share\tTotal Amount\tCurrency\tFX Rate\r\n2026-08-01T12:00:00.000Z\t${oversized}\tBUY - MARKET\t1\tEUR 1\tEUR -1\tEUR\t1\r\n`))).toThrow("512 UTF-8 bytes");
    const portfolioHeaders = "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code";
    expect(() => parseMoneyImport(Buffer.from(`${portfolioHeaders}\r\n2026-08-01T12:00:00.000Z,2026-08-01,${oversized},CASH,CARD_TRANSACTION,,,,,,-3.500000,,,EUR,,,,Payment,stable-id,Merchant,,reference,5812\r\n`))).toThrow("512 UTF-8 bytes");
  });

  it("accepts portfolio sales as realized-gain events", () => {
    const headers = "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code";
    const row = "2026-08-09T03:08:51.123Z,2026-08-09,DEFAULT,TRADING,SELL,ETF,Global ETF,VWCE,0.5,120,60,-1,,EUR,,,,Sell,sale-1,,,,";
    const parsed = parseMoneyImport(Buffer.from(`${headers}\r\n${row}\r\n`));
    expect(parsed.transactions[0]).toMatchObject({ flowKind: "trade", baseAmountMinor: 6_000, baseFeeMinor: 100 });
    expect(parsed.investmentEvents[0]).toMatchObject({ eventKind: "sell", symbol: "VWCE", quantity: "0.5" });
  });

  it("drops private payment fields and sanitizes account identifiers from portfolio CSV descriptions", () => {
    const headers = "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code";
    const row = "2026-08-09T03:08:51.123Z,2026-08-09,DEFAULT,CASH,CARD_TRANSACTION,,,,,,-3.500000,,,EUR,,,,Payment to DE00AAAAAAAAAAAAAAAAAA,stable-id,Merchant,DE00AAAAAAAAAAAAAAAAAA,private reference,5812";

    const parsed = parseMoneyImport(Buffer.from(`${headers}\r\n${row}\r\n`));

    expect(parsed.format).toBe(PORTFOLIO_TRANSACTION_FORMAT);
    expect(parsed.transactions[0]).toMatchObject({ description: "Payment to [account]", amountMinor: -350, category: "dining", mcc: "5812" });
    expect(JSON.stringify(parsed)).not.toContain("private reference");
    expect(JSON.stringify(parsed)).not.toContain("DE00AAAAAAAAAAAAAAAAAA");
  });

  it("keeps Revolut trading FX support but rejects non-EUR portfolio rows", () => {
    const headers = "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code";
    const row = "2026-08-09T03:08:51.123Z,2026-08-09,DEFAULT,CASH,CARD_TRANSACTION,,,,,,-3.500000,,,USD,,,,Funding,stable-id,Merchant,,private reference,5812";
    expect(() => parseMoneyImport(Buffer.from(`${headers}\r\n${row}\r\n`))).toThrow("currently supports EUR only");
  });

  it("preserves portfolio fee and tax correction signs", () => {
    const headers = "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code";
    const rows = [
      "2026-08-09T03:08:51.123Z,2026-08-09,DEFAULT,TRADING,TAX_OPTIMIZATION,FUND,Fund,FUND,,,0,-1.25,-2.50,EUR,,,,Tax,id-1,,,,",
      "2026-08-10T03:08:51.123Z,2026-08-10,DEFAULT,TRADING,TAX_OPTIMIZATION,FUND,Fund,FUND,,,0,0.25,0.50,EUR,,,,Correction,id-2,,,,"
    ];
    const parsed = parseMoneyImport(Buffer.from([headers, ...rows].join("\r\n")));
    expect(parsed.transactions.map(({ feeMinor, taxMinor }) => ({ feeMinor, taxMinor }))).toEqual([
      { feeMinor: 125, taxMinor: 250 }, { feeMinor: -25, taxMinor: -50 }
    ]);
  });

});

describe("balance snapshot parser", () => {
  it("imports the explicit cutover CSV contract and normalizes legacy day-first dates", () => {
    const parsed = parseMoneyImport(Buffer.from([
      "Date,Account,Value,Role,Currency",
      "08/08/2026,Broker,1580.25,investment,EUR",
      "2026-08-09,Cash,420,cash,EUR"
    ].join("\r\n")));

    expect(parsed.format).toBe(MONEY_BALANCE_SNAPSHOT_FORMAT);
    expect(parsed.balanceSnapshots).toEqual([
      expect.objectContaining({ date: "2026-08-08", valueMinor: 158_025 }),
      expect.objectContaining({ date: "2026-08-09", valueMinor: 42_000 })
    ]);
    expect(parsed.transactions.every((item) => item.flowKind === "balance_adjustment")).toBe(true);
  });

  it("rejects non-EUR, impossible dates, and repeated account/date keys during preview parsing", () => {
    const headers = "Date,Account,Value,Role,Currency";
    expect(() => parseMoneyImport(Buffer.from(`${headers}\r\n2026-08-09,Cash,1,cash,USD\r\n`))).toThrow("currently supports EUR only");
    expect(() => parseMoneyImport(Buffer.from(`${headers}\r\n2026-02-30,Cash,1,cash,EUR\r\n`))).toThrow("invalid Date");
    expect(() => parseMoneyImport(Buffer.from(`${headers}\r\n2026-08-09,Cash,1,cash,EUR\r\n2026-08-09,Cash,2,cash,EUR\r\n`))).toThrow("duplicates the account and date");
  });
});

describe("money import service", () => {
  it("reports existing source rows during preview", async () => {
    const repository = new MemoryMoneyRepository();
    const bytes = fixture(["Transfer\tCurrent\t2026-08-09 5:08:51\t2026-08-09 5:08:51\tTop up\t10\t0\tEUR\tCOMPLETED\t10"]);
    const parsed = parseMoneyImport(bytes);
    repository.sourceKeys.add(parsed.transactions[0]!.sourceKey);

    const preview = await new MoneyImportService(repository).preview("account.tsv", bytes);

    expect(preview.duplicateCount).toBe(1);
    expect(preview.digest).toBe(parsed.digest);
  });

  it("reports duplicate source rows within the selected statement", async () => {
    const row = "Transfer\tCurrent\t2026-08-09 5:08:51\t2026-08-09 5:08:51\tTop up\t10\t0\tEUR\tCOMPLETED\t10";
    const preview = await new MoneyImportService(new MemoryMoneyRepository()).preview("account.tsv", fixture([row, row]));

    expect(preview.rowCount).toBe(2);
    expect(preview.duplicateCount).toBe(1);
  });

  it("requires the committed file to match the preview digest", async () => {
    const service = new MoneyImportService(new MemoryMoneyRepository());
    const bytes = fixture(["Transfer\tCurrent\t2026-08-09 5:08:51\t2026-08-09 5:08:51\tTop up\t10\t0\tEUR\tCOMPLETED\t10"]);

    await expect(service.commit({
      filename: "account.tsv",
      bytes,
      expectedDigest: "0".repeat(64),
      actor: "operator@example.test"
    })).rejects.toMatchObject({ code: "file_changed" });
  });

  it("validates explicit transfer dispositions", () => {
    const service = new MoneyImportService(new MemoryMoneyRepository());
    expect(() => service.setTransferDisposition({ transactionId: "00000000-0000-4000-8000-000000000000", disposition: "uncategorized" })).toThrow("valid transfer disposition");
  });
});

describe("money import route", () => {
  it("requires an authenticated same-origin multipart request", async () => {
    const preview = vi.fn().mockResolvedValue({ ok: true });
    const response = await previewMoneyImport(routeInput(
      uploadRequest("https://attacker.example", fixture(["Transfer\tCurrent\t2026-08-09 5:08:51\t2026-08-09 5:08:51\tTop up\t10\t0\tEUR\tCOMPLETED\t10"])),
      preview
    ));

    expect(response.status).toBe(403);
    expect(preview).not.toHaveBeenCalled();
  });

  it("bounds streamed JSON bodies without Content-Length", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ transactionId: "00000000-0000-4000-8000-000000000000", category: "other", padding: "x".repeat(20_000) }));
    const request = new Request("https://tools.example.test/api/money/categories", { method: "POST", headers: { Origin: "https://tools.example.test", "Content-Type": "application/json" }, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), duplex: "half" } as RequestInit);
    const response = await updateMoneyCategory({ request, params: {}, context: { principal: { subject: "subject", email: "operator@example.test" }, runtime: { publicOrigin: "https://tools.example.test", moneyImports: { setTransactionCategory: vi.fn() } } } } as unknown as PlatformRouteInput);
    expect(response.status).toBe(413);
  });

  it("bounds streamed multipart bodies without Content-Length", async () => {
    const bytes = new Uint8Array(11 * 1024 * 1024 + 1);
    const request = new Request("https://tools.example.test/api/money/imports/preview", { method: "POST", headers: { Origin: "https://tools.example.test", "Content-Type": "multipart/form-data; boundary=money" }, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), duplex: "half" } as RequestInit);
    const response = await previewMoneyImport(routeInput(request, vi.fn()));
    expect(response.status).toBe(413);
  });

  it("rejects malformed Content-Length before reading the request", async () => {
    const request = new Request("https://tools.example.test/api/money/categories", { method: "POST", headers: { Origin: "https://tools.example.test", "Content-Type": "application/json", "Content-Length": "wat" }, body: "{}" });
    const response = await updateMoneyCategory({ request, params: {}, context: { principal: { subject: "subject", email: "operator@example.test" }, runtime: { publicOrigin: "https://tools.example.test", moneyImports: { setTransactionCategory: vi.fn() } } } } as unknown as PlatformRouteInput);
    expect(response.status).toBe(400);
  });

  it("persists an explicit transfer disposition independently from category", async () => {
    const setTransferDisposition = vi.fn().mockResolvedValue(undefined);
    const request = new Request("https://tools.example.test/api/money/transfers", { method: "POST", headers: { Origin: "https://tools.example.test", "Content-Type": "application/json" }, body: JSON.stringify({ transactionId: "00000000-0000-4000-8000-000000000000", disposition: "refund" }) });
    const response = await updateMoneyTransfer({ request, params: {}, context: { principal: { subject: "subject", email: "operator@example.test" }, runtime: { publicOrigin: "https://tools.example.test", moneyImports: { setTransferDisposition } } } } as unknown as PlatformRouteInput);
    expect(response.status).toBe(200);
    expect(setTransferDisposition).toHaveBeenCalledWith({ transactionId: "00000000-0000-4000-8000-000000000000", disposition: "refund" });
  });

  it("passes only the private file bytes and filename to preview", async () => {
    const result = { format: REVOLUT_CASH_FORMAT };
    const preview = vi.fn().mockResolvedValue(result);
    const bytes = fixture(["Transfer\tCurrent\t2026-08-09 5:08:51\t2026-08-09 5:08:51\tTop up\t10\t0\tEUR\tCOMPLETED\t10"]);
    const response = await previewMoneyImport(routeInput(uploadRequest("https://tools.example.test", bytes), preview));

    expect(response.status).toBe(200);
    expect(preview).toHaveBeenCalledOnce();
    expect(preview.mock.calls[0]?.[0]).toBe("account.tsv");
    expect([...preview.mock.calls[0]?.[1] as Uint8Array]).toEqual([...bytes]);
  });
});

describe("money schema and Option A route contract", () => {
  it("registers finance tables in the guarded tools schema push", () => {
    const schema = readFileSync(new URL("../database/postgres-schema.ts", import.meta.url), "utf8");
    const config = readFileSync(new URL("../field-guide/drizzle.tools.config.ts", import.meta.url), "utf8");
    for (const table of ["money_accounts", "money_imports", "money_transactions", "money_investment_events", "money_category_rules", "money_balance_snapshots"]) {
      expect(schema).toContain(`\"${table}\"`);
      expect(config).toContain(`\"${table}\"`);
    }
    expect(schema).toContain('accountId: uuid("account_id").notNull().references(() => moneyAccounts.id)');
    expect(schema).toContain("table.accountId, table.matchField, table.matchValue");
    expect(schema).toContain('transferDisposition: text("transfer_disposition")');
  });

  it("uses the selected workspace views without legacy search values", () => {
    const route = readFileSync(new URL("../src/routes/money.tsx", import.meta.url), "utf8");
    for (const view of ["cash-flow", "transactions", "investments", "accounts", "insights", "data"]) expect(route).toContain(`\"${view}\"`);
    for (const old of ["activity", "spending", "balances", "imports", "history", "predictions"]) expect(route).not.toContain(`search.view === \"${old}\"`);
  });
});

function statement(rows: string[]) {
  return parseMoneyImport(fixture(rows));
}

function fixture(rows: string[]) {
  return Buffer.from(`${header}\r\n${rows.join("\r\n")}\r\n`, "utf8");
}

function uploadRequest(origin: string, bytes: Uint8Array) {
  const form = new FormData();
  const contents = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.set("file", new File([contents], "account.tsv", { type: "text/tab-separated-values" }));
  return new Request("https://tools.example.test/api/money/imports/preview", {
    method: "POST",
    headers: { Origin: origin },
    body: form
  });
}

function routeInput(request: Request, preview: ReturnType<typeof vi.fn>) {
  return {
    request,
    params: {},
    context: {
      principal: { subject: "subject", email: "operator@example.test" },
      runtime: {
        publicOrigin: "https://tools.example.test",
        moneyImports: { preview }
      }
    }
  } as unknown as PlatformRouteInput;
}

class MemoryMoneyRepository implements MoneyRepository {
  readonly sourceKeys = new Set<string>();

  async existingSourceKeys(sourceKeys: readonly string[]) {
    return new Set(sourceKeys.filter((key) => this.sourceKeys.has(key)));
  }

  async commitImport(_input: MoneyImportCommitInput): Promise<MoneyImportReceipt> {
    throw new Error("Not used by this test.");
  }

  async readLedgerSnapshot(): Promise<MoneyLedgerSnapshot> {
    return {
      imports: [], activity: [], transactionCount: 0, revertedCount: 0, transferReview: { linkedPairs: 0, unlinkedCount: 0, unresolvedPositiveCount: 0, unresolvedNegativeCount: 0 }, accounts: [], accountLabels: {}, accountRoles: {}, months: [],
      spending: { months: [], categories: [], uncategorizedCount: 0 },
      investments: { positions: [], totals: { eventCount: 0, boughtMinor: 0, soldMinor: 0, incomeMinor: 0, feesMinor: 0, taxesMinor: 0 }, realized: { positions: [], totals: { saleCount: 0, proceedsMinor: 0, costBasisMinor: 0, gainMinor: 0, unmatchedSaleCount: 0 } } },
      planning: { ready: true, unresolvedTransferCount: 0, medianMonthlyNetMinor: 0, observedMonthCount: 6, projections: [{ months: 6, changeMinor: 0 }, { months: 12, changeMinor: 0 }] },
      accountLastObserved: {}
    };
  }

  async readActivityPage() { return { items: [], total: 0, hasMore: false }; }

  async setTransactionCategory() { return { affectedCount: 1 }; }
  async setTransferDisposition() {}
  async addManualBalance() {}

  async readiness() {}
  async close() {}
}
