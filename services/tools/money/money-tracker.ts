import { createPrivateKey } from "node:crypto";
import { GoogleAuth } from "google-auth-library";

export const MONEY_TRACKER_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const MONEY_TRACKER_SHEET_NAME = "Monthly Entries";

export type MoneyTrackerConfig = Readonly<{
  spreadsheetId: string;
  sheetName: typeof MONEY_TRACKER_SHEET_NAME;
  credentials: Readonly<{ client_email: string; private_key: string }>;
}>;

export type MoneyTrackerSnapshot = Readonly<{
  accounts: string[];
  months: Array<{
    date: string;
    total: number;
    values: Record<string, number>;
  }>;
  latestDate?: string;
}>;

export function loadMoneyTrackerConfig(env: Readonly<Record<string, string | undefined>>): MoneyTrackerConfig {
  const spreadsheetId = env.MONEY_TRACKER_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) throw new Error("Missing required environment variable: MONEY_TRACKER_SPREADSHEET_ID");
  const source = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!source) throw new Error("Missing required environment variable: GOOGLE_SERVICE_ACCOUNT_JSON");

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must contain valid JSON");
  }
  if (!isRecord(parsed) || typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must contain client_email and private_key");
  }
  if (!parsed.client_email.endsWith(".gserviceaccount.com")) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON contains an invalid client_email");
  }
  try {
    createPrivateKey(parsed.private_key);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON contains an invalid private_key");
  }
  return {
    spreadsheetId,
    sheetName: MONEY_TRACKER_SHEET_NAME,
    credentials: { client_email: parsed.client_email, private_key: parsed.private_key }
  };
}

export function createMoneyTracker(config: MoneyTrackerConfig) {
  const auth = new GoogleAuth({ credentials: config.credentials, scopes: [MONEY_TRACKER_SHEETS_SCOPE] });
  return {
    async readSnapshot(): Promise<MoneyTrackerSnapshot> {
      const client = await auth.getClient();
      const escapedName = config.sheetName.replaceAll("'", "''");
      const response = await client.request<{ values?: unknown[][] }>({
        url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/'${escapedName}'!A:D`,
        params: { valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" }
      });
      return buildSnapshot(response.data.values ?? []);
    }
  };
}

export function buildSnapshot(rows: unknown[][]): MoneyTrackerSnapshot {
  const [headers = [], ...dataRows] = rows;
  const dateIndex = headers.indexOf("Date");
  const accountIndex = headers.indexOf("Account");
  const valueIndex = headers.indexOf("Value");
  if (dateIndex < 0 || accountIndex < 0 || valueIndex < 0) {
    throw new Error("Monthly Entries must contain Date, Account, and Value columns");
  }

  const byDate = new Map<string, Record<string, number>>();
  const accounts = new Set<string>();
  for (const row of dataRows) {
    const date = row[dateIndex];
    const account = row[accountIndex];
    const value = row[valueIndex];
    if (typeof date !== "string" || typeof account !== "string" || typeof value !== "number") continue;
    const values = byDate.get(date) ?? {};
    if (account in values) throw new Error(`Monthly Entries contains duplicate account ${account} on ${date}`);
    values[account] = value;
    byDate.set(date, values);
    accounts.add(account);
  }
  const months = [...byDate.entries()]
    .map(([date, values]) => ({ date, values, total: Object.values(values).reduce((sum, value) => sum + value, 0) }))
    .sort((left, right) => parseSheetDate(left.date) - parseSheetDate(right.date));
  return {
    accounts: [...accounts].sort((left, right) => left.localeCompare(right)),
    months,
    latestDate: months.at(-1)?.date
  };
}

function parseSheetDate(value: string): number {
  const [day, month, year] = value.split("/").map(Number);
  const time = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return Number.isNaN(time) ? 0 : time;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
