import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import {
  MONEY_CATEGORIES,
  MONEY_TRANSFER_DISPOSITIONS,
  MONEY_BALANCE_SNAPSHOT_FORMAT,
  PORTFOLIO_TRANSACTION_FORMAT,
  REVOLUT_CASH_FORMAT,
  REVOLUT_TRADING_FORMAT,
  SPARKASSE_CASH_FORMAT,
  type MoneyCategory,
  type MoneyTransferDisposition
} from "./money-enums.js";
import { parseSparkasseWorkbook, SparkasseWorkbookError } from "./sparkasse-xlsx.js";

export {
  MONEY_CATEGORIES,
  MONEY_TRANSFER_DISPOSITIONS,
  MONEY_BALANCE_SNAPSHOT_FORMAT,
  PORTFOLIO_TRANSACTION_FORMAT,
  REVOLUT_CASH_FORMAT,
  REVOLUT_TRADING_FORMAT,
  SPARKASSE_CASH_FORMAT,
  type MoneyCategory,
  type MoneyTransferDisposition
} from "./money-enums.js";

export const MONEY_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const MONEY_INDEXED_IDENTITY_MAX_BYTES = 512;
export const MONEY_IMPORT_MAX_ROWS = 100_000;
export const SPARKASSE_TRANSFER_TYPES = [
  "HOMEBANKINGUEBERWEISUNG",
  "UEBERWEISUNG",
  "UEBERWEISUNG ZU IHREN GUNSTEN",
  "SEPA ECHTZEITUEBERWEISUNG",
  "IHR DAUERAUFTRAG",
  "BAREINLAGE",
  "VERSCHIEDENE WERTE"
] as const;

const CASH_HEADERS = ["Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State", "Balance"] as const;
const TRADING_HEADERS = ["Date", "Ticker", "Type", "Quantity", "Price per share", "Total Amount", "Currency", "FX Rate"] as const;
const PORTFOLIO_HEADERS = ["datetime", "date", "account_type", "category", "type", "asset_class", "name", "symbol", "shares", "price", "amount", "fee", "tax", "currency", "original_amount", "original_currency", "fx_rate", "description", "transaction_id", "counterparty_name", "counterparty_iban", "payment_reference", "mcc_code"] as const;
const BALANCE_HEADERS = ["Date", "Account", "Value", "Role", "Currency"] as const;

const CASH_TYPES = new Set(["Transfer", "Card Payment", "Topup", "Exchange", "Card Refund", "ATM", "CARD_CREDIT", "Interest"]);
const TRADING_TYPES = new Set(["DIVIDEND", "CUSTODY FEE", "CASH TOP-UP", "BUY - MARKET", "CASH WITHDRAWAL", "SELL - MARKET", "STOCK SPLIT", "DIVIDEND TAX (CORRECTION)", "CUSTODY FEE REVERSAL", "TRANSFER FROM REVOLUT TRADING LTD TO REVOLUT SECURITIES EUROPE UAB", "TRANSFER FROM REVOLUT BANK UAB TO REVOLUT SECURITIES EUROPE UAB"]);
const PORTFOLIO_TYPES = new Set(["BUY", "SELL", "INTEREST_PAYMENT", "CARD_TRANSACTION", "CUSTOMER_INBOUND", "TAX_OPTIMIZATION", "MIGRATION", "TRANSFER_INBOUND", "TRANSFER_INSTANT_OUTBOUND", "STOCKPERK", "CUSTOMER_INPAYMENT", "TRANSFER_INSTANT_INBOUND"]);
const SPARKASSE_FEE_TYPES = new Set(["GEBUEHREN", "KOMMISSION AUF UEBERWEISUNGEN", "KOMM. ECHTZEITUEBERWEISUNG"]);
const SPARKASSE_TAX_TYPES = new Set(["STEMPELSTEUER"]);
const SPARKASSE_SPEND_TYPES = new Set(["LASTSCHRIFT", "BEZAHLUNG EU LAENDER"]);
const SPARKASSE_INCOME_TYPES = new Set(["BEZUEGE", "AUSGANGSBELEG"]);
const SPARKASSE_TRANSFER_TYPE_SET = new Set<string>(SPARKASSE_TRANSFER_TYPES);
const SPARKASSE_TRANSACTION_TYPES = new Set([...SPARKASSE_FEE_TYPES, ...SPARKASSE_TAX_TYPES, ...SPARKASSE_SPEND_TYPES, ...SPARKASSE_INCOME_TYPES, ...SPARKASSE_TRANSFER_TYPES]);

export type MoneyImportFormat = typeof REVOLUT_CASH_FORMAT | typeof REVOLUT_TRADING_FORMAT | typeof PORTFOLIO_TRANSACTION_FORMAT | typeof MONEY_BALANCE_SNAPSHOT_FORMAT | typeof SPARKASSE_CASH_FORMAT;
export type MoneyProvider = "revolut" | "portfolio_export" | "manual" | "sparkasse";
export type MoneyAccountRole = "cash" | "investment";
export type MoneyTransactionStatus = "completed" | "reverted";
export type MoneyFlowKind = "spend" | "income" | "refund" | "transfer" | "trade" | "investment_income" | "fee" | "tax" | "balance_adjustment";
export type MoneyInvestmentEventKind = "buy" | "sell" | "dividend" | "fee" | "tax" | "split" | "cash_transfer" | "position_transfer" | "delivery";

export type MoneyLedgerTransaction = Readonly<{
  sourceKey: string;
  sourceRow: number;
  provider: MoneyProvider;
  accountRole: MoneyAccountRole;
  accountExternalRef: string;
  accountName: string;
  occurredAt: string;
  completedAt?: string;
  localDate: string;
  description: string;
  amountMinor: number;
  feeMinor: number;
  taxMinor: number;
  baseAmountMinor?: number;
  baseFeeMinor?: number;
  baseTaxMinor?: number;
  baseCurrency?: "EUR";
  balanceAfterMinor?: number;
  currency: string;
  status: MoneyTransactionStatus;
  sourceType: string;
  mcc?: string;
  flowKind: MoneyFlowKind;
  category: MoneyCategory;
}>;

export type MoneyInvestmentEventInput = Readonly<{
  transactionSourceKey: string;
  eventKind: MoneyInvestmentEventKind;
  symbol?: string;
  name?: string;
  assetClass?: string;
  quantity?: string;
  unitPrice?: string;
  priceCurrency?: string;
  fxRate?: string;
}>;

export type MoneyBalanceSnapshotInput = Readonly<{
  accountExternalRef: string;
  date: string;
  observedAt: string;
  sourceRow: number;
  valueMinor: number;
  currency: string;
}>;

export type MoneyImportAccountPreview = Readonly<{
  externalRef: string;
  name: string;
  product: string;
  currency: string;
  rowCount: number;
  completedCount: number;
  revertedCount: number;
  endingBalanceMinor?: number;
  reconciliationMismatchCount: number;
}>;

export type ParsedMoneyImport = Readonly<{
  format: MoneyImportFormat;
  digest: string;
  rowCount: number;
  dateRange: Readonly<{ from: string; to: string }>;
  accounts: readonly MoneyImportAccountPreview[];
  transactions: readonly MoneyLedgerTransaction[];
  investmentEvents: readonly MoneyInvestmentEventInput[];
  balanceSnapshots: readonly MoneyBalanceSnapshotInput[];
  warnings: readonly string[];
}>;

export type MoneyImportPreview = Readonly<{
  format: MoneyImportFormat;
  digest: string;
  filename: string;
  bytes: number;
  rowCount: number;
  duplicateCount: number;
  investmentEventCount: number;
  dateRange: Readonly<{ from: string; to: string }>;
  accounts: readonly MoneyImportAccountPreview[];
  warnings: readonly string[];
}>;

export class MoneyImportValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "MoneyImportValidationError"; this.code = code; }
}

/** Detects and parses one of the supported private export formats. */
export function parseMoneyImport(bytes: Uint8Array): ParsedMoneyImport {
  if (bytes.byteLength === 0) throw invalid("empty_file", "The selected file is empty.");
  if (bytes.byteLength > MONEY_IMPORT_MAX_BYTES) throw invalid("file_too_large", "Money imports must be 10 MB or smaller.");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (isZip(bytes)) {
    try {
      return parseSparkasse(bytes, digest);
    } catch (error) {
      if (error instanceof SparkasseWorkbookError) throw invalid("invalid_sparkasse_workbook", error.message);
      throw error;
    }
  }
  const source = decode(bytes);
  const firstLine = source.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const parsed = firstLine.includes("\t") ? rows(source, "\t") : rows(source, ",");
  const [headers, ...dataRows] = parsed;
  if (!headers) throw invalid("empty_statement", "The statement contains no rows.");
  if (!dataRows.length) throw invalid("empty_statement", "The statement contains no transactions.");
  if (dataRows.length > MONEY_IMPORT_MAX_ROWS) throw invalid("too_many_rows", `Money imports may contain at most ${MONEY_IMPORT_MAX_ROWS.toLocaleString("en-GB")} rows.`);
  if (sameStrings(headers, CASH_HEADERS)) return parseCash(dataRows, digest);
  if (sameStrings(headers, TRADING_HEADERS)) return parseTrading(dataRows, digest);
  if (sameStrings(headers, PORTFOLIO_HEADERS)) return parsePortfolio(dataRows, digest);
  if (sameStrings(headers, BALANCE_HEADERS)) return parseBalances(dataRows, digest);
  throw invalid("unsupported_format", "This file does not match a supported money export format.");
}

function parseSparkasse(bytes: Uint8Array, digest: string): ParsedMoneyImport {
  const workbook = parseSparkasseWorkbook(bytes);
  if (workbook.transactions.length > MONEY_IMPORT_MAX_ROWS) throw invalid("too_many_rows", `Money imports may contain at most ${MONEY_IMPORT_MAX_ROWS.toLocaleString("en-GB")} rows.`);
  const iban = workbook.iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) throw invalid("invalid_account", "The Sparkasse workbook contains an invalid IBAN.");
  const openingBalanceMinor = parseMinorUnits(workbook.openingBalance, 13, "Anfangssaldo");
  const closingBalanceMinor = parseMinorUnits(workbook.closingBalance, 14, "Endsaldo");
  const accountExternalRef = `sparkasse:cash:${fingerprint([iban]).slice(0, 24)}:EUR`;
  const accountName = `Sparkasse · ${iban.slice(-4)}`;
  assertIndexedIdentity(accountExternalRef, 6, "Account");
  const occurrences = new Map<string, number>();
  let balanceAfterMinor = openingBalanceMinor;
  const transactions = [...workbook.transactions].reverse().map((row): MoneyLedgerTransaction => {
    const rawAmountMinor = parseMinorUnits(row.amount, row.sourceRow, "Betrag EUR");
    const rawDescription = row.description.trim();
    if (!rawDescription) throw invalid("invalid_description", `Row ${row.sourceRow} has no Beschreibung.`);
    const sourceType = rawDescription.split(/\r?\n/, 1)[0]!.trim().toUpperCase();
    if (!SPARKASSE_TRANSACTION_TYPES.has(sourceType)) throw invalid("unsupported_transaction_type", `Row ${row.sourceRow} contains unsupported Sparkasse transaction type ${JSON.stringify(sourceType)}.`);
    const identity = [row.bookingDate, row.valueDate, rawDescription, row.amount];
    const identityKey = JSON.stringify(identity);
    const occurrence = occurrences.get(identityKey) ?? 0;
    occurrences.set(identityKey, occurrence + 1);
    const feeMinor = SPARKASSE_FEE_TYPES.has(sourceType) ? -rawAmountMinor : 0;
    const taxMinor = SPARKASSE_TAX_TYPES.has(sourceType) ? -rawAmountMinor : 0;
    const amountMinor = feeMinor || taxMinor ? 0 : rawAmountMinor;
    balanceAfterMinor += rawAmountMinor;
    const occurredAt = `${row.bookingDate}T12:00:00.000Z`;
    const completedAt = `${row.valueDate}T12:00:00.000Z`;
    const description = sanitizeDescription(rawDescription);
    const flowKind = sparkasseFlow(sourceType, rawAmountMinor, rawDescription, workbook.accountHolder);
    return {
      sourceKey: fingerprint([SPARKASSE_CASH_FORMAT, iban, ...identity, String(occurrence)]), sourceRow: row.sourceRow,
      provider: "sparkasse", accountRole: "cash", accountExternalRef, accountName, occurredAt, completedAt,
      localDate: row.bookingDate, description, amountMinor, feeMinor, taxMinor, baseAmountMinor: amountMinor,
      baseFeeMinor: feeMinor, baseTaxMinor: taxMinor, baseCurrency: "EUR", balanceAfterMinor, currency: "EUR",
      status: "completed", sourceType, flowKind,
      category: inferMoneyCategory(flowKind, sourceType, description)
    };
  });
  if (balanceAfterMinor !== closingBalanceMinor) {
    throw invalid("sparkasse_balance_mismatch", "The Sparkasse transactions do not reconcile with the workbook closing balance.");
  }
  const accounts = accountPreviews(transactions);
  return result(SPARKASSE_CASH_FORMAT, digest, transactions, [], buildBalanceSnapshots(transactions, true), accounts, []);
}

function parseCash(dataRows: string[][], digest: string): ParsedMoneyImport {
  const transactions = dataRows.map((row, index) => cashRow(row, index + 2));
  const accounts = accountPreviews(transactions);
  return result(REVOLUT_CASH_FORMAT, digest, transactions, [], buildBalanceSnapshots(transactions), accounts,
    accounts.some((account) => account.reconciliationMismatchCount) ? ["One or more running balances do not reconcile. Review the account summary before importing."] : []);
}

function cashRow(row: string[], sourceRow: number): MoneyLedgerTransaction {
  assertColumns(row, CASH_HEADERS.length, sourceRow);
  const [type, product, started, completed, rawDescription, amount, fee, currency, state, balance] = row;
  if (!type || !CASH_TYPES.has(type)) throw invalid("unsupported_transaction_type", `Row ${sourceRow} contains unsupported transaction type ${JSON.stringify(type ?? "")}.`);
  if (!product?.trim()) throw invalid("invalid_product", `Row ${sourceRow} has no product.`);
  assertIndexedIdentity(product.trim(), sourceRow, "Product");
  assertCurrency(currency, sourceRow);
  assertEuro(currency, sourceRow);
  if (state !== "COMPLETED" && state !== "REVERTED") throw invalid("unsupported_state", `Row ${sourceRow} contains unsupported state ${JSON.stringify(state ?? "")}.`);
  const occurredAt = parseBerlinTimestamp(started, sourceRow, "Started Date");
  const completedAt = completed ? parseBerlinTimestamp(completed, sourceRow, "Completed Date") : undefined;
  const amountMinor = parseMinorUnits(amount, sourceRow, "Amount");
  const feeMinor = Math.abs(parseMinorUnits(fee, sourceRow, "Fee"));
  const balanceAfterMinor = balance ? parseMinorUnits(balance, sourceRow, "Balance") : undefined;
  const description = sanitizeDescription(rawDescription ?? "");
  const flowKind = cashFlow(type, amountMinor, description);
  return {
    sourceKey: fingerprint([REVOLUT_CASH_FORMAT, ...row]), sourceRow, provider: "revolut", accountRole: "cash",
    accountExternalRef: `revolut:cash:${product.trim().toLocaleLowerCase("en-GB")}:${currency}`,
    accountName: `Revolut ${product.trim()}${currency === "EUR" ? "" : ` · ${currency}`}`,
    occurredAt: occurredAt.toISOString(), ...(completedAt ? { completedAt: completedAt.toISOString() } : {}),
    localDate: (completed || started)!.slice(0, 10), description, amountMinor, feeMinor, taxMinor: 0,
    ...(currency === "EUR" ? { baseAmountMinor: amountMinor, baseFeeMinor: feeMinor, baseTaxMinor: 0, baseCurrency: "EUR" as const } : {}),
    ...(balanceAfterMinor === undefined ? {} : { balanceAfterMinor }), currency: currency!,
    status: state === "COMPLETED" ? "completed" : "reverted", sourceType: type,
    flowKind, category: inferMoneyCategory(flowKind, type, description)
  };
}

function parseTrading(dataRows: string[][], digest: string): ParsedMoneyImport {
  const transactions: MoneyLedgerTransaction[] = [];
  const investmentEvents: MoneyInvestmentEventInput[] = [];
  for (const [index, row] of dataRows.entries()) {
    const sourceRow = index + 2;
    assertColumns(row, TRADING_HEADERS.length, sourceRow);
    const [date, ticker, type, quantity, priceText, totalText, currency, fxRate] = row;
    if (!type || !TRADING_TYPES.has(type)) throw invalid("unsupported_transaction_type", `Row ${sourceRow} contains unsupported transaction type ${JSON.stringify(type ?? "")}.`);
    assertCurrency(currency, sourceRow);
    if (ticker) assertIndexedIdentity(ticker, sourceRow, "Ticker");
    const occurredAt = parseIsoTimestamp(date, sourceRow, "Date");
    const total = parseCurrencyAmount(totalText, currency!, sourceRow, "Total Amount");
    const price = parseOptionalCurrencyAmount(priceText, currency!, sourceRow, "Price per share");
    const sourceKey = fingerprint([REVOLUT_TRADING_FORMAT, ...row]);
    const eventKind = tradingEventKind(type);
    const amountMinor = tradingSignedAmount(type, total);
    if (currency !== "EUR" && !fxRate) throw invalid("missing_fx_rate", `Row ${sourceRow} requires an FX Rate.`);
    const baseAmountMinor = currency === "EUR" ? amountMinor : convertToEuroMinor(amountMinor, fxRate!, sourceRow);
    const feeMinor = type.includes("FEE") ? -total : 0;
    const taxMinor = type.includes("TAX") ? -total : 0;
    const flowKind = tradingFlow(type);
    transactions.push({
      sourceKey, sourceRow, provider: "revolut", accountRole: "investment", accountExternalRef: "revolut:investment:trading",
      accountName: "Revolut Trading", occurredAt: occurredAt.toISOString(), completedAt: occurredAt.toISOString(),
      localDate: occurredAt.toISOString().slice(0, 10), description: sanitizeDescription([type, ticker].filter(Boolean).join(" · ")),
      amountMinor, feeMinor, taxMinor, baseAmountMinor,
      baseFeeMinor: currency === "EUR" ? feeMinor : convertToEuroMinor(feeMinor, fxRate!, sourceRow),
      baseTaxMinor: currency === "EUR" ? taxMinor : convertToEuroMinor(taxMinor, fxRate!, sourceRow), baseCurrency: "EUR",
      currency: currency!, status: "completed", sourceType: type, flowKind, category: flowKind === "transfer" ? "transfer" : type.includes("FEE") ? "fees" : type.includes("TAX") ? "taxes" : "investments"
    });
    investmentEvents.push({
      transactionSourceKey: sourceKey, eventKind, ...(ticker ? { symbol: ticker } : {}),
      ...(quantity ? { quantity: investmentQuantity(eventKind, quantity, sourceRow, "Quantity") } : {}),
      ...(price ? { unitPrice: price.amount, priceCurrency: price.currency } : {}),
      ...(fxRate ? { fxRate: positiveDecimal(fxRate, sourceRow, "FX Rate") } : {})
    });
  }
  return result(REVOLUT_TRADING_FORMAT, digest, transactions, investmentEvents, [], accountPreviews(transactions), []);
}

function parsePortfolio(dataRows: string[][], digest: string): ParsedMoneyImport {
  const transactions: MoneyLedgerTransaction[] = [];
  const investmentEvents: MoneyInvestmentEventInput[] = [];
  for (const [index, row] of dataRows.entries()) {
    const sourceRow = index + 2;
    assertColumns(row, PORTFOLIO_HEADERS.length, sourceRow);
    const [timestamp, date, accountType, sourceCategory, type, assetClass, name, symbol, shares, price, amount, fee, tax, currency, , , fxRate, rawDescription, transactionId, counterpartyName, , , mcc] = row;
    if (!type || !PORTFOLIO_TYPES.has(type)) throw invalid("unsupported_transaction_type", `Row ${sourceRow} contains unsupported transaction type ${JSON.stringify(type ?? "")}.`);
    if (!accountType) throw invalid("invalid_product", `Row ${sourceRow} has no account type.`);
    assertIndexedIdentity(accountType, sourceRow, "account_type");
    if (symbol) assertIndexedIdentity(symbol, sourceRow, "symbol");
    assertCurrency(currency, sourceRow);
    assertEuro(currency, sourceRow);
    const occurredAt = parseIsoTimestamp(timestamp, sourceRow, "datetime");
    if (date !== occurredAt.toISOString().slice(0, 10)) throw invalid("invalid_date", `Row ${sourceRow} has inconsistent date fields.`);
    const amountMinor = !amount && type === "MIGRATION" ? 0 : parseMinorUnits(amount, sourceRow, "amount");
    // Source costs are negative and corrections positive. Store costs as positive,
    // which preserves correction signs instead of turning refunds into extra cost.
    const feeMinor = fee ? -parseMinorUnits(fee, sourceRow, "fee") : 0;
    const taxMinor = tax ? -parseMinorUnits(tax, sourceRow, "tax") : 0;
    const sourceKey = transactionId?.trim() ? fingerprint([PORTFOLIO_TRANSACTION_FORMAT, transactionId.trim()]) : fingerprint([PORTFOLIO_TRANSACTION_FORMAT, ...row.slice(0, 19)]);
    const role: MoneyAccountRole = sourceCategory === "TRADING" || sourceCategory === "DELIVERY" ? "investment" : "cash";
    const description = sanitizeDescription(rawDescription || counterpartyName || [type, name, symbol].filter(Boolean).join(" · "));
    const flowKind = portfolioFlow(type, amountMinor);
    transactions.push({
      sourceKey, sourceRow, provider: "portfolio_export", accountRole: role,
      accountExternalRef: `portfolio:${accountType.toLocaleLowerCase("en-GB")}:${role}`,
      accountName: `Portfolio ${role === "investment" ? "Investments" : "Cash"}`, occurredAt: occurredAt.toISOString(), completedAt: occurredAt.toISOString(),
      localDate: date!, description, amountMinor, feeMinor, taxMinor, baseAmountMinor: amountMinor, baseFeeMinor: feeMinor, baseTaxMinor: taxMinor, baseCurrency: "EUR", currency: currency!, status: "completed", sourceType: type,
      ...(mcc?.trim() ? { mcc: mcc.trim() } : {}), flowKind, category: sourceCategory === "TRADING" || sourceCategory === "DELIVERY" ? "investments" : flowKind === "transfer" ? "transfer" : type === "CARD_TRANSACTION" ? categorizeDescription(description, mcc) : type === "INTEREST_PAYMENT" ? "income" : flowKind === "tax" ? "taxes" : flowKind === "balance_adjustment" ? "adjustment" : "uncategorized"
    });
    const eventKind = portfolioEventKind(type, sourceCategory);
    if (eventKind) investmentEvents.push({
      transactionSourceKey: sourceKey, eventKind, ...(symbol ? { symbol } : {}), ...(name ? { name } : {}), ...(assetClass ? { assetClass } : {}),
      ...(shares ? { quantity: investmentQuantity(eventKind, shares, sourceRow, "shares") } : {}), ...(price ? { unitPrice: decimal(price, sourceRow, "price"), priceCurrency: currency! } : {}),
      ...(fxRate ? { fxRate: positiveDecimal(fxRate, sourceRow, "fx_rate") } : {})
    });
  }
  return result(PORTFOLIO_TRANSACTION_FORMAT, digest, transactions, investmentEvents, [], accountPreviews(transactions), []);
}

function parseBalances(dataRows: string[][], digest: string): ParsedMoneyImport {
  const transactions: MoneyLedgerTransaction[] = [];
  const balanceSnapshots: MoneyBalanceSnapshotInput[] = [];
  const keys = new Map<string, number>();
  for (const [index, row] of dataRows.entries()) {
    const sourceRow = index + 2;
    assertColumns(row, BALANCE_HEADERS.length, sourceRow);
    const [rawDate, rawAccount, rawValue, role, currency] = row;
    const date = normalizedDate(rawDate, sourceRow);
    const accountName = rawAccount?.trim();
    if (!accountName || accountName.length > 100) throw invalid("invalid_account", `Row ${sourceRow} has an invalid Account.`);
    if (role !== "cash" && role !== "investment") throw invalid("invalid_role", `Row ${sourceRow} has an invalid Role.`);
    assertCurrency(currency, sourceRow);
    assertEuro(currency, sourceRow);
    const valueMinor = parseMinorUnits(rawValue, sourceRow, "Value");
    const occurredAt = `${date}T12:00:00.000Z`;
    const accountExternalRef = `manual:${accountName.toLocaleLowerCase("en-GB")}:${role}:${currency}`;
    const snapshotKey = `${accountExternalRef}:${date}`;
    const duplicateRow = keys.get(snapshotKey);
    if (duplicateRow !== undefined) throw invalid("duplicate_balance_snapshot", `Row ${sourceRow} duplicates the account and date from row ${duplicateRow}.`);
    keys.set(snapshotKey, sourceRow);
    const sourceKey = fingerprint([MONEY_BALANCE_SNAPSHOT_FORMAT, date, accountName, rawValue!, role, currency!]);
    transactions.push({ sourceKey, sourceRow, provider: "manual", accountRole: role, accountExternalRef, accountName,
      occurredAt, completedAt: occurredAt, localDate: date, description: "Imported balance snapshot", amountMinor: 0,
      feeMinor: 0, taxMinor: 0, ...(currency === "EUR" ? { baseAmountMinor: 0, baseFeeMinor: 0, baseTaxMinor: 0, baseCurrency: "EUR" as const } : {}),
      balanceAfterMinor: valueMinor, currency, status: "completed", sourceType: "Balance snapshot", flowKind: "balance_adjustment", category: "adjustment" });
    balanceSnapshots.push({ accountExternalRef, date, observedAt: occurredAt, sourceRow, valueMinor, currency });
  }
  return result(MONEY_BALANCE_SNAPSHOT_FORMAT, digest, transactions, [], balanceSnapshots, accountPreviews(transactions), []);
}

function result(format: MoneyImportFormat, digest: string, transactions: MoneyLedgerTransaction[], investmentEvents: MoneyInvestmentEventInput[], balanceSnapshots: MoneyBalanceSnapshotInput[], accounts: MoneyImportAccountPreview[], warnings: string[]): ParsedMoneyImport {
  const dates = transactions.map((item) => item.localDate).sort();
  return { format, digest, rowCount: transactions.length, dateRange: { from: dates[0]!, to: dates.at(-1)! }, accounts, transactions, investmentEvents, balanceSnapshots, warnings };
}

function accountPreviews(transactions: readonly MoneyLedgerTransaction[]): MoneyImportAccountPreview[] {
  const grouped = new Map<string, MoneyLedgerTransaction[]>();
  for (const transaction of transactions) {
    const rows = grouped.get(transaction.accountExternalRef) ?? [];
    rows.push(transaction);
    grouped.set(transaction.accountExternalRef, rows);
  }
  return [...grouped.entries()].map(([externalRef, accountRows]) => {
    const latest = accountRows.findLast((row) => row.status === "completed" && row.balanceAfterMinor !== undefined);
    return { externalRef, name: accountRows[0]!.accountName, product: accountRows[0]!.accountRole, currency: accountRows[0]!.accountRole === "investment" ? "EUR" : accountRows[0]!.currency,
      rowCount: accountRows.length, completedCount: accountRows.filter((row) => row.status === "completed").length,
      revertedCount: accountRows.filter((row) => row.status === "reverted").length,
      ...(latest?.balanceAfterMinor === undefined ? {} : { endingBalanceMinor: latest.balanceAfterMinor }), reconciliationMismatchCount: reconciliationMismatches(accountRows) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function reconciliationMismatches(rows: readonly MoneyLedgerTransaction[]) {
  let previous: number | undefined; let mismatches = 0;
  for (const row of rows) {
    if (row.status !== "completed" || row.balanceAfterMinor === undefined) continue;
    if (row.flowKind === "balance_adjustment") { previous = row.balanceAfterMinor; continue; }
    if (previous !== undefined && previous + row.amountMinor - row.feeMinor - row.taxMinor !== row.balanceAfterMinor) mismatches += 1;
    previous = row.balanceAfterMinor;
  }
  return mismatches;
}

function buildBalanceSnapshots(transactions: readonly MoneyLedgerTransaction[], sourceSequenceIsChronological = false) {
  const latest = new Map<string, MoneyBalanceSnapshotInput>();
  for (const row of transactions) {
    if (row.status !== "completed" || row.balanceAfterMinor === undefined) continue;
    const key = `${row.accountExternalRef}:${row.localDate}`;
    const candidate = { accountExternalRef: row.accountExternalRef, date: row.localDate, observedAt: row.completedAt ?? row.occurredAt, sourceRow: row.sourceRow, valueMinor: row.balanceAfterMinor, currency: row.currency };
    const current = latest.get(key);
    if (sourceSequenceIsChronological || !current || current.observedAt < candidate.observedAt || (current.observedAt === candidate.observedAt && current.sourceRow < candidate.sourceRow)) latest.set(key, candidate);
  }
  return [...latest.values()].sort((a, b) => a.date.localeCompare(b.date) || a.accountExternalRef.localeCompare(b.accountExternalRef));
}

function cashFlow(type: string, amount: number, description: string): MoneyFlowKind {
  if (/^(closing transaction|balance migration to another region or legal entity)$/i.test(description.trim())) return "balance_adjustment";
  if (type === "Card Payment" && /^hype$/i.test(description.trim())) return "transfer";
  if (type === "Card Payment" || type === "ATM") return amount < 0 ? "spend" : "refund";
  if (type === "Card Refund" || type === "CARD_CREDIT") return "refund";
  if (type === "Interest") return "investment_income";
  return "transfer";
}
export function inferMoneyCategory(flowKind: MoneyFlowKind, sourceType: string, description: string, mcc?: string): MoneyCategory {
  if (flowKind === "transfer") return "transfer";
  if (flowKind === "balance_adjustment") return "adjustment";
  if (flowKind === "investment_income" || flowKind === "income") return "income";
  if (flowKind === "fee") return "fees";
  if (flowKind === "tax") return "taxes";
  if (flowKind === "trade") return "investments";
  if (sourceType === "ATM") return "cash";
  return categorizeDescription(description, mcc);
}
function tradingFlow(type: string): MoneyFlowKind { return type.includes("BUY") || type.includes("SELL") || type === "STOCK SPLIT" || type.startsWith("POSITION TRANSFER") ? "trade" : type === "DIVIDEND" ? "investment_income" : type.includes("FEE") ? "fee" : type.includes("TAX") ? "tax" : "transfer"; }
function tradingEventKind(type: string): MoneyInvestmentEventKind { return type.includes("BUY") ? "buy" : type.includes("SELL") ? "sell" : type === "DIVIDEND" ? "dividend" : type.includes("FEE") ? "fee" : type.includes("TAX") ? "tax" : type === "STOCK SPLIT" ? "split" : type.startsWith("POSITION TRANSFER") ? "position_transfer" : "cash_transfer"; }
function tradingSignedAmount(type: string, total: number) { return type.includes("BUY") ? -Math.abs(total) : type.includes("SELL") ? Math.abs(total) : total; }
function portfolioFlow(type: string, amount: number): MoneyFlowKind { return type === "BUY" || type === "SELL" || type === "MIGRATION" ? "trade" : type === "INTEREST_PAYMENT" ? "investment_income" : type === "CARD_TRANSACTION" ? (amount < 0 ? "spend" : "refund") : type === "TAX_OPTIMIZATION" ? "tax" : "transfer"; }
function portfolioEventKind(type: string, category: string | undefined): MoneyInvestmentEventKind | undefined { return type === "BUY" ? "buy" : type === "SELL" ? "sell" : type === "INTEREST_PAYMENT" ? "dividend" : type === "TAX_OPTIMIZATION" ? "tax" : type === "MIGRATION" ? "position_transfer" : category === "DELIVERY" ? "delivery" : undefined; }
function sparkasseFlow(type: string, amount: number, description: string, accountHolder: string): MoneyFlowKind {
  if (SPARKASSE_FEE_TYPES.has(type)) return "fee";
  if (SPARKASSE_TAX_TYPES.has(type)) return "tax";
  if (SPARKASSE_SPEND_TYPES.has(type) && amount < 0 && /\b(revolut|trade republic)\b/i.test(description)) return "transfer";
  if (SPARKASSE_SPEND_TYPES.has(type)) return amount < 0 ? "spend" : "refund";
  if (SPARKASSE_INCOME_TYPES.has(type) && amount > 0) return "income";
  if (SPARKASSE_TRANSFER_TYPE_SET.has(type)) {
    if (amount >= 0 || type === "BAREINLAGE" || type === "VERSCHIEDENE WERTE") return "transfer";
    return sparkasseBeneficiaryMatchesHolder(description, accountHolder) ? "transfer" : "spend";
  }
  throw new Error("Sparkasse transaction classification is incomplete.");
}

function sparkasseBeneficiaryMatchesHolder(description: string, accountHolder: string) {
  const holderTokens = normalizedIdentityTokens(accountHolder);
  if (holderTokens.length < 2) return false;
  const body = description.split(/\r?\n/).slice(1).join(" ");
  const beneficiary = body.split(/\biban\s+beg\.\s*:/i, 1)[0] ?? "";
  const beneficiaryTokens = new Set(normalizedIdentityTokens(beneficiary));
  return holderTokens.every((token) => beneficiaryTokens.has(token));
}

function normalizedIdentityTokens(value: string) {
  return value.toLocaleLowerCase("en-GB").normalize("NFKD").replace(/\p{Diacritic}/gu, "").match(/[a-z0-9]+/g) ?? [];
}

const MCC_CATEGORY_RULES: readonly Readonly<{ category: MoneyCategory; pattern: RegExp }>[] = [
  { category: "groceries", pattern: /^(5411|5422|5441|5451|5462|5499)$/ },
  { category: "dining", pattern: /^581[1-4]$/ },
  { category: "transport", pattern: /^(4111|4121|4131|4784|4789|5541|5542|7523)$/ },
  { category: "shopping", pattern: /^(5310|5311|5331|5399|5611|5621|5631|5641|5651|5655|5661|5681|5691|5697|5698|5699|5712|5713|5714|5719|5722|5732|5734|5941|5942|5943|5944|5945|5946|5947|5948|5949|5999)$/ },
  { category: "health", pattern: /^(5912|5975|5976|8011|8021|8031|8041|8042|8043|8049|8050|8062|8071|8099)$/ },
  { category: "travel", pattern: /^(4411|4722|7011)$/ },
  { category: "education", pattern: /^(8211|8220|8241|8244|8249|8299)$/ },
  { category: "entertainment", pattern: /^(7832|7911|7922|7929|7932|7933|7991|7992|7993|7994|7996|7997|7998|7999)$/ }
];

const DESCRIPTION_CATEGORY_RULES: readonly Readonly<{ category: MoneyCategory; pattern: RegExp }>[] = [
  { category: "housing", pattern: /\b(rent|landlord|mortgage|utility|utilities|electricity|gas bill|studentenf(?:o|oe)rderungsstiftung)\b/ },
  { category: "groceries", pattern: /\b(billa|spar|hofer|aldi|lidl|rewe|edeka|despar|mpreis|supermarket|grocer(?:y|ies)|denn'?s|biomarkt|hello ?fresh|huel|koncoop|naturalia|agrocenter|sudtiroler milch|fruits?|misa tea)\b|s.*dtiroler milch|l.*derach|winestore|denn.s|^basic$/ },
  { category: "dining", pattern: /\b(lieferando|foodora|deliveroo|delivery hero|just eat|takeaway|restaurant|cafe|coffee|backwerk|mcdonald'?s|confiserie|autogrill|swing kitchen|bistrot|bakerei|konditorei|kebab|imbiss|pizzeria|biteclub|bao bar|veggiezz|frozen yogurt|litalissimo|humus|old wild west|serways|brot und spiele|juice factory|le crobag|speckstandl|nihonbashi|tramuntana|giannotti et fil|balthasar kaffee|bar edelweiss|stadtkebab|landhausbar|coca-cola|gourmet)\b|l'autentico|b.*ckerei|caf.|str.*ck|b.*renwirt|^chez angele?$/ },
  { category: "transport", pattern: /\b(oebb|obb|enio|westbahn|wiener linien|wienerlinien|klimaticket|trenitalia|salzburg verkehr|flixbus|eurolanes|uber|taxi|train|rail|parking|parkhaus|parkplatz|parcheggio|garage|wipark|autostrade?|brennero|bolzano sud|tiermobilit|suedtirol pass|altoadige p ass|esso|petrol|fuel|kvw service)\b|a.bb|^tier$|^wien$/ },
  { category: "health", pattern: /\b(apotheke|pharmacy|pharmac|farmacia|doctor|dentist|hospital|fitinn|drogerie|bipa|dermopraxis|beauty|diagnostik)\b|salone gran chi/ },
  { category: "travel", pattern: /\b(booking\.com|hotel|airline|flight|camping|holafly|sardinia vera)\b/ },
  { category: "subscriptions", pattern: /\b(netflix|spotify|audible|youtube|deezer|libro\.fm|t3 chat|openai|chatgpt|claude|google(?: cloud| chrome)?|microsoft|jetbrains|paddle|replicate|iliad|tim|vodafone|hot telekom|1mobile|purevpn|server dedicato|hetzner|railway|convex|cloudflare|virtualsolu|aruba\.it|amazon prime|evernote|readwise|bitwarden|akiflow|obsidian|cursor|reclaim|groq|unraid|filebot|rize subscription)\b|netflixinte/ },
  { category: "education", pattern: /\b(tu wien|technische universitaet wien|fahrschule|frontendmasters|knowt)\b/ },
  { category: "entertainment", pattern: /\b(steam|riot games|hrk game|playstation|g2a|kinguin|chrono(?: gg)?|electronic arts|eneba|mmoga|twitch|znipe|ticketmaster|wien ticket|p3 comix|billardcafe|der klub|wiener eistraum|cineplexx|google play|itunes|itch\.io|abavent|addicted to rock|sport arena wien)\b|steamgames|hrkdistribu|^khm sk/ },
  { category: "shopping", pattern: /\b(amazon|apple(?:\.com)?|ikea|dbrand|zalando|zara|muller|printbox|paperlike|massdrop|redbubble|thomann|media ?markt|mediaworld|media world|linus tech tips|nike|etsy|uniqlo|brookssport|puma|urban outfitters|samsung|rhinoshield|sportler|nencini sport|beyerdynamic|darn tough|calida|cyberport|e-tec\.at|xxxlutz|action|thalia|athesia|unifi|seven technology|legami|kurzgesagt|h&m|obi|ceramics|flaconi|dell sas|athleticgre|hutstuebele|heogmbh|spri\.ng|ctdi|blitzhandel24|surteesstudios|az delivery|paga in 3 rate|salewa|fellhof)\b|sixpol|m.*ller|ebay/ },
  { category: "gifts", pattern: /\b(wikimedia|blumen)\b/ },
  { category: "taxes", pattern: /\b(pagopa)\b/ },
  { category: "fees", pattern: /\b(hannafinanz|poste italiane|post fa|post 1153|packlink|servizio spid)\b|fedex/ },
  { category: "cash", pattern: /\b(ricarica yap)\b|^yap$/ },
  { category: "investments", pattern: /\btrade republic\b/ },
  { category: "other", pattern: /\bpaypal\b/ }
];

/** Auditable defaults inferred from source MCCs and recurring merchant names. User rules take precedence in the repository. */
export function categorizeDescription(description: string, mcc?: string): MoneyCategory {
  const normalizedMcc = mcc?.trim();
  const mccMatch = normalizedMcc && MCC_CATEGORY_RULES.find((rule) => rule.pattern.test(normalizedMcc));
  if (mccMatch) return mccMatch.category;
  const value = description.toLocaleLowerCase("en-GB").normalize("NFKD").replace(/\p{Diacritic}/gu, "");
  const descriptionMatch = DESCRIPTION_CATEGORY_RULES.find((rule) => rule.pattern.test(value));
  if (descriptionMatch) return descriptionMatch.category;
  return "uncategorized";
}

function decode(bytes: Uint8Array) { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw invalid("invalid_encoding", "Money imports must use UTF-8 encoding."); } }
function rows(source: string, delimiter: string) { try { return parse(source, { bom: true, delimiter, quote: '"', relax_column_count: false, skip_empty_lines: true }) as string[][]; } catch { throw invalid("invalid_delimited_file", "The statement could not be parsed as a supported delimited export."); } }
function assertColumns(row: string[], count: number, sourceRow: number) { if (row.length !== count) throw invalid("invalid_row", `Row ${sourceRow} does not contain ${count} columns.`); }
function assertCurrency(value: string | undefined, sourceRow: number): asserts value is string { if (!value || !/^[A-Z]{3}$/.test(value)) throw invalid("invalid_currency", `Row ${sourceRow} has an invalid currency.`); }
function assertEuro(value: string, sourceRow: number) { if (value !== "EUR") throw invalid("unsupported_currency", `Row ${sourceRow} uses ${value}. This import currently supports EUR only.`); }
function parseMinorUnits(value: string | undefined, sourceRow: number, field: string) { if (!value || !/^-?\d+(?:\.\d+)?$/.test(value)) throw invalid("invalid_amount", `Row ${sourceRow} has an invalid ${field}.`); const negative = value.startsWith("-"); const [whole, fraction = ""] = (negative ? value.slice(1) : value).split("."); if (fraction.slice(2).replaceAll("0", "")) throw invalid("fractional_minor_units", `Row ${sourceRow} has unsupported fractional minor units in ${field}.`); const minor = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, "0")); if (!Number.isSafeInteger(minor)) throw invalid("amount_out_of_range", `Row ${sourceRow} has an out-of-range ${field}.`); return negative ? -minor : minor; }
function convertToEuroMinor(value: number, rate: string, sourceRow: number) { const normalized = decimal(rate, sourceRow, "FX Rate"); const [whole, fraction = ""] = normalized.split("."); const denominator = BigInt(`${whole}${fraction}`); if (denominator <= 0n) throw invalid("invalid_decimal", `Row ${sourceRow} has an invalid FX Rate.`); const numerator = BigInt(Math.abs(value)) * 10n ** BigInt(fraction.length); const rounded = (numerator + denominator / 2n) / denominator; const result = Number(rounded) * Math.sign(value); if (!Number.isSafeInteger(result)) throw invalid("amount_out_of_range", `Row ${sourceRow} has an out-of-range converted amount.`); return result; }
function parseCurrencyAmount(value: string | undefined, expected: string, sourceRow: number, field: string) { const match = /^([A-Z]{3})\s+(-?\d+(?:\.\d+)?)$/.exec(value ?? ""); if (!match || match[1] !== expected) throw invalid("invalid_amount", `Row ${sourceRow} has an invalid ${field}.`); return parseMinorUnits(match[2], sourceRow, field); }
function parseOptionalCurrencyAmount(value: string | undefined, expected: string, sourceRow: number, field: string) { if (!value) return undefined; const match = /^([A-Z]{3})\s+(-?\d+(?:\.\d+)?)$/.exec(value); if (!match || match[1] !== expected) throw invalid("invalid_amount", `Row ${sourceRow} has an invalid ${field}.`); return { currency: match[1]!, amount: decimal(match[2]!, sourceRow, field) }; }
function decimal(value: string, sourceRow: number, field: string) { const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value); if (!match) throw invalid("invalid_decimal", `Row ${sourceRow} has an invalid ${field}.`); const integralDigits = match[2]!.replace(/^0+(?=\d)/, "").length; const fractionalDigits = match[3]?.length ?? 0; if (integralDigits > 18 || fractionalDigits > 12) throw invalid("decimal_out_of_range", `Row ${sourceRow} has an out-of-range ${field}; at most 18 integral and 12 fractional digits are supported.`); const normalized = value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""); return normalized === "-0" ? "0" : normalized; }
function positiveDecimal(value: string, sourceRow: number, field: string) { const normalized = decimal(value, sourceRow, field); if (Number(normalized) <= 0) throw invalid("invalid_decimal", `Row ${sourceRow} requires a positive ${field}.`); return normalized; }
function investmentQuantity(eventKind: MoneyInvestmentEventKind, value: string, sourceRow: number, field: string) { return eventKind === "buy" || eventKind === "sell" || eventKind === "split" ? positiveDecimal(value, sourceRow, field) : decimal(value, sourceRow, field); }
function assertIndexedIdentity(value: string, sourceRow: number, field: string) { if (new TextEncoder().encode(value).byteLength > MONEY_INDEXED_IDENTITY_MAX_BYTES) throw invalid("indexed_identity_too_long", `Row ${sourceRow} has a ${field} longer than ${MONEY_INDEXED_IDENTITY_MAX_BYTES} UTF-8 bytes.`); }
function parseIsoTimestamp(value: string | undefined, sourceRow: number, field: string) { if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw invalid("invalid_date", `Row ${sourceRow} has an invalid ${field}.`); const date = new Date(value); if (Number.isNaN(date.getTime()) || !validCalendarDate(value.slice(0, 10))) throw invalid("invalid_date", `Row ${sourceRow} has an invalid ${field}.`); return date; }
function normalizedDate(value: string | undefined, sourceRow: number) { const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? ""); const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value ?? ""); const date = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : local ? `${local[3]}-${local[2]}-${local[1]}` : undefined; if (!date || !validCalendarDate(date)) throw invalid("invalid_date", `Row ${sourceRow} has an invalid Date.`); return date; }
function validCalendarDate(value: string) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match) return false; const [, year, month, day] = match.map(Number); const date = new Date(Date.UTC(year!, month! - 1, day!)); return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day; }
function parseBerlinTimestamp(value: string | undefined, sourceRow: number, field: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) throw invalid("invalid_date", `Row ${sourceRow} has an invalid ${field}.`);
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const calendar = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!validCalendarDate(calendar) || hour! > 23 || minute! > 59 || second! > 59) throw invalid("invalid_date", `Row ${sourceRow} has an invalid ${field}.`);
  const localMillis = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
  const candidates = [localMillis - 2 * 3_600_000, localMillis - 3_600_000]
    .map((millis) => new Date(millis)).filter((candidate) => berlinParts(candidate) === `${calendar} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`);
  if (!candidates.length) throw invalid("invalid_date", `Row ${sourceRow} has a nonexistent Europe/Berlin time in ${field}.`);
  // Fall-back-hour ambiguity is resolved to the first occurrence (summer offset).
  return candidates.sort((left, right) => left.getTime() - right.getTime())[0]!;
}
const berlinFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function berlinParts(value: Date) { const parts = Object.fromEntries(berlinFormatter.formatToParts(value).map((part) => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`; }
function sanitizeDescription(value: string) { return value.trim().replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/gi, "[account]").replace(/\s+/g, " ").slice(0, 500); }
function fingerprint(fields: readonly string[]) { return createHash("sha256").update(JSON.stringify(fields)).digest("hex"); }
function sameStrings(actual: readonly string[], expected: readonly string[]) { return actual.length === expected.length && expected.every((value, index) => actual[index] === value); }
function isZip(bytes: Uint8Array) { return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04; }
function invalid(code: string, message: string) { return new MoneyImportValidationError(code, message); }
