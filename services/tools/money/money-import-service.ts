import {
  MONEY_IMPORT_MAX_BYTES,
  MONEY_CATEGORIES,
  MoneyImportValidationError,
  parseMoneyImport,
  type MoneyCategory,
  type MoneyImportPreview
} from "./money-import-domain.js";
import type { MoneyImportReceipt, MoneyLedgerSnapshot, MoneyRepository } from "./money-repository.js";

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

  readLedgerSnapshot(): Promise<MoneyLedgerSnapshot> {
    return this.repository.readLedgerSnapshot();
  }

  readActivityPage(input: Readonly<{ query: string; flow?: string; offset: number; limit: number }>) {
    const query = input.query.trim().slice(0, 100);
    const flows = ["spend", "income", "refund", "transfer", "trade", "investment_income", "fee", "tax", "balance_adjustment"] as const;
    const flow = input.flow && flows.includes(input.flow as typeof flows[number]) ? input.flow as typeof flows[number] : undefined;
    if (input.flow && !flow) throw new MoneyImportValidationError("invalid_flow", "The activity flow filter is invalid.");
    if (!Number.isSafeInteger(input.offset) || input.offset < 0) throw new MoneyImportValidationError("invalid_offset", "The activity offset is invalid.");
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) throw new MoneyImportValidationError("invalid_limit", "The activity limit is invalid.");
    return this.repository.readActivityPage({ query, ...(flow ? { flow } : {}), offset: input.offset, limit: input.limit });
  }

  setTransactionCategory(input: Readonly<{ transactionId: string; category: string; actor: string; createRule: boolean }>) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.transactionId)) {
      throw new MoneyImportValidationError("invalid_transaction", "The transaction identifier is invalid.");
    }
    if (!MONEY_CATEGORIES.includes(input.category as MoneyCategory)) {
      throw new MoneyImportValidationError("invalid_category", "The selected category is invalid.");
    }
    return this.repository.setTransactionCategory({ ...input, category: input.category as MoneyCategory });
  }

  addManualBalance(input: Readonly<{ accountName: string; role: string; date: string; value: string; currency: string }>) {
    const accountName = input.accountName.trim();
    if (!accountName || accountName.length > 100) throw new MoneyImportValidationError("invalid_account", "Enter an account name up to 100 characters.");
    if (input.role !== "cash" && input.role !== "investment") throw new MoneyImportValidationError("invalid_role", "Select a valid account role.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))) throw new MoneyImportValidationError("invalid_date", "Enter a valid snapshot date.");
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new MoneyImportValidationError("invalid_currency", "Enter a valid three-letter currency.");
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(input.value)) throw new MoneyImportValidationError("invalid_value", "Enter a balance with no more than two decimal places.");
    const [whole, fraction = ""] = input.value.replace("-", "").split(".");
    const absolute = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    const valueMinor = input.value.startsWith("-") ? -absolute : absolute;
    if (!Number.isSafeInteger(valueMinor)) throw new MoneyImportValidationError("invalid_value", "The balance is outside the supported range.");
    return this.repository.addManualBalance({ accountName, role: input.role, date: input.date, valueMinor, currency: input.currency });
  }

  readiness(): Promise<void> {
    return this.repository.readiness();
  }

  close(): Promise<void> {
    return this.repository.close();
  }
}

function validateFilename(filename: string) {
  const value = filename.trim();
  if (!value || value.length > 255 || value.includes("/") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new MoneyImportValidationError("invalid_filename", "The import filename is invalid.");
  }
  if (!/\.(?:tsv|csv)$/i.test(value)) {
    throw new MoneyImportValidationError("unsupported_file_extension", "Money imports must be a .tsv or .csv file.");
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
