import {
  MONEY_IMPORT_MAX_BYTES,
  MONEY_CATEGORIES,
  MONEY_TRANSFER_DISPOSITIONS,
  MoneyImportValidationError,
  parseMoneyImport,
  type MoneyCategory,
  type MoneyTransferDisposition,
  type MoneyImportPreview
} from "./money-import-domain.js";
import type { MoneyImportReceipt, MoneyLedgerScope, MoneyLedgerSnapshot, MoneyRepository } from "./money-repository.js";

export class MoneyImportService {
  constructor(private readonly repository: MoneyRepository) {}

  async preview(filename: string, bytes: Uint8Array): Promise<MoneyImportPreview> {
    const safeFilename = validateFilename(filename);
    const parsed = parseMoneyImport(bytes);
    const uniqueSourceKeys = [...new Set(parsed.transactions.map((transaction) => transaction.sourceKey))];
    const existing = await this.repository.existingSourceKeys(uniqueSourceKeys);
    return {
      format: parsed.format,
      digest: parsed.digest,
      filename: safeFilename,
      bytes: bytes.byteLength,
      rowCount: parsed.rowCount,
      duplicateCount: parsed.rowCount - (uniqueSourceKeys.length - existing.size),
      investmentEventCount: parsed.investmentEvents.length,
      dateRange: parsed.dateRange,
      accounts: parsed.accounts,
      warnings: parsed.warnings
    };
  }

  async commit(input: Readonly<{
    filename: string;
    bytes: Uint8Array;
    expectedDigest: string;
    actor: string;
  }>): Promise<MoneyImportReceipt> {
    const filename = validateFilename(input.filename);
    if (!/^[a-f0-9]{64}$/.test(input.expectedDigest)) {
      throw new MoneyImportValidationError("invalid_preview_digest", "The import preview digest is invalid.");
    }
    const parsed = parseMoneyImport(input.bytes);
    if (parsed.digest !== input.expectedDigest) {
      throw new MoneyImportValidationError("file_changed", "The selected file changed after preview. Preview it again before importing.");
    }
    return this.repository.commitImport({
      digest: parsed.digest,
      format: parsed.format,
      filename,
      bytes: input.bytes.byteLength,
      rowCount: parsed.rowCount,
      actor: input.actor,
      transactions: parsed.transactions,
      investmentEvents: parsed.investmentEvents,
      balanceSnapshots: parsed.balanceSnapshots,
      warnings: parsed.warnings
    });
  }

  async deleteImport(importId: string) {
    assertImportId(importId);
    const deleted = await this.repository.deleteImport(importId);
    if (!deleted) {
      throw new MoneyImportValidationError("import_not_found", "The money import no longer exists.");
    }
    return deleted;
  }

  reimportAll() {
    return this.repository.reimportAll();
  }

  readLedgerSnapshot(scope: MoneyLedgerScope): Promise<MoneyLedgerSnapshot> {
    return this.repository.readLedgerSnapshot(scope);
  }

  readActivityPage(input: Readonly<{ query: string; flow?: string; accountId?: string; category?: string; reviewOnly?: boolean; sort?: string; direction?: string; offset: number; limit: number }>) {
    const query = input.query.trim().slice(0, 100);
    const flows = ["spend", "income", "refund", "transfer", "trade", "investment_income", "fee", "tax", "balance_adjustment"] as const;
    const flow = input.flow && flows.includes(input.flow as typeof flows[number]) ? input.flow as typeof flows[number] : undefined;
    const sorts = ["date", "description", "account", "flow", "category", "costs", "amount"] as const;
    const sort = input.sort && sorts.includes(input.sort as typeof sorts[number]) ? input.sort as typeof sorts[number] : input.sort ? undefined : "date";
    const direction = input.direction === "asc" || input.direction === "desc" ? input.direction : input.direction ? undefined : "desc";
    const accountId = input.accountId?.trim();
    const category = input.category && MONEY_CATEGORIES.includes(input.category as MoneyCategory) ? input.category as MoneyCategory : undefined;
    if (input.flow && !flow) throw new MoneyImportValidationError("invalid_flow", "The activity flow filter is invalid.");
    if (!sort) throw new MoneyImportValidationError("invalid_sort", "The activity sort is invalid.");
    if (!direction) throw new MoneyImportValidationError("invalid_sort", "The activity sort direction is invalid.");
    if (input.category && !category) throw new MoneyImportValidationError("invalid_category", "The activity category filter is invalid.");
    if (accountId) assertUuid(accountId, "invalid_account", "The activity account filter is invalid.");
    if (!Number.isSafeInteger(input.offset) || input.offset < 0) throw new MoneyImportValidationError("invalid_offset", "The activity offset is invalid.");
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) throw new MoneyImportValidationError("invalid_limit", "The activity limit is invalid.");
    return this.repository.readActivityPage({ query, ...(flow ? { flow } : {}), ...(accountId ? { accountId } : {}), ...(category ? { category } : {}), ...(input.reviewOnly ? { reviewOnly: true } : {}), sort, direction, offset: input.offset, limit: input.limit });
  }

  setTransactionCategory(input: Readonly<{ transactionId: string; category: string; actor: string; createRule: boolean }>) {
    assertTransactionId(input.transactionId);
    if (!MONEY_CATEGORIES.includes(input.category as MoneyCategory)) {
      throw new MoneyImportValidationError("invalid_category", "The selected category is invalid.");
    }
    return this.repository.setTransactionCategory({ ...input, category: input.category as MoneyCategory });
  }

  async deleteCategoryRule(ruleId: string) {
    assertUuid(ruleId, "invalid_category_rule", "The category-rule identifier is invalid.");
    const deleted = await this.repository.deleteCategoryRule(ruleId);
    if (!deleted) throw new MoneyImportValidationError("category_rule_not_found", "The category rule no longer exists.");
    return deleted;
  }

  setTransferDisposition(input: Readonly<{ transactionId: string; disposition: string }>) {
    assertTransactionId(input.transactionId);
    if (!MONEY_TRANSFER_DISPOSITIONS.includes(input.disposition as MoneyTransferDisposition)) {
      throw new MoneyImportValidationError("invalid_transfer_disposition", "Select a valid transfer disposition.");
    }
    return this.repository.setTransferDisposition({ transactionId: input.transactionId, disposition: input.disposition as MoneyTransferDisposition });
  }

  setTransferDispositions(input: Readonly<{ transactionIds: readonly string[]; disposition: string }>) {
    const transactionIds = [...new Set(input.transactionIds)];
    if (!transactionIds.length || transactionIds.length > 500) {
      throw new MoneyImportValidationError("invalid_transaction_selection", "Select between 1 and 500 transfer rows.");
    }
    for (const transactionId of transactionIds) assertTransactionId(transactionId);
    if (!MONEY_TRANSFER_DISPOSITIONS.includes(input.disposition as MoneyTransferDisposition)) {
      throw new MoneyImportValidationError("invalid_transfer_disposition", "Select a valid transfer disposition.");
    }
    return this.repository.setTransferDispositions({ transactionIds, disposition: input.disposition as MoneyTransferDisposition });
  }

  addManualBalance(input: Readonly<{ accountId?: string; accountName?: string; date: string; value: string; currency: string }>) {
    const accountId = input.accountId?.trim();
    const accountName = input.accountName?.trim();
    if (Boolean(accountId) === Boolean(accountName)) throw new MoneyImportValidationError("invalid_account", "Select an existing cash account or enter one new account name.");
    if (accountId) assertUuid(accountId, "invalid_account", "The selected cash account is invalid.");
    if (accountName && accountName.length > 100) throw new MoneyImportValidationError("invalid_account", "Enter an account name up to 100 characters.");
    if (!validDate(input.date)) throw new MoneyImportValidationError("invalid_date", "Enter a valid snapshot date.");
    if (input.currency !== "EUR") throw new MoneyImportValidationError("unsupported_currency", "Balance snapshots currently support EUR only.");
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(input.value)) throw new MoneyImportValidationError("invalid_value", "Enter a balance with no more than two decimal places.");
    const [whole, fraction = ""] = input.value.replace("-", "").split(".");
    const absolute = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    const valueMinor = input.value.startsWith("-") ? -absolute : absolute;
    if (!Number.isSafeInteger(valueMinor)) throw new MoneyImportValidationError("invalid_value", "The balance is outside the supported range.");
    return this.repository.addManualBalance({ ...(accountId ? { accountId } : { accountName: accountName! }), date: input.date, valueMinor, currency: input.currency });
  }

  readiness(): Promise<void> {
    return this.repository.readiness();
  }

  close(): Promise<void> {
    return this.repository.close();
  }
}

function assertTransactionId(value: string) {
  assertUuid(value, "invalid_transaction", "The transaction identifier is invalid.");
}

function assertUuid(value: string, code: string, message: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new MoneyImportValidationError(code, message);
}

function assertImportId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new MoneyImportValidationError("invalid_import", "The import identifier is invalid.");
  }
}

function validDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

function validateFilename(filename: string) {
  const value = filename.trim();
  if (!value || value.length > 255 || value.includes("/") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new MoneyImportValidationError("invalid_filename", "The import filename is invalid.");
  }
  if (!/\.(?:xlsx|tsv|csv)$/i.test(value)) {
    throw new MoneyImportValidationError("unsupported_file_extension", "Money imports must be an .xlsx, .tsv, or .csv file.");
  }
  return value;
}

export function assertMoneyImportFileSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new MoneyImportValidationError("empty_file", "The selected file is empty.");
  }
  if (size > MONEY_IMPORT_MAX_BYTES) {
    throw new MoneyImportValidationError("file_too_large", "Money imports must be 10 MB or smaller.");
  }
}
