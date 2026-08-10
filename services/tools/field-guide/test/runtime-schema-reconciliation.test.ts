import { describe, expect, it } from "vitest";
import { moneyImportConstraintRepairs } from "../src/runtime-schema-reconciliation.js";

describe("runtime schema reconciliation", () => {
  it("repairs missing and stale money import constraints", () => {
    expect(moneyImportConstraintRepairs([])).toEqual({ provider: true, format: true });
    expect(moneyImportConstraintRepairs([
      { name: "money_accounts_provider_check", definition: "CHECK (provider IN ('revolut', 'manual'))" },
      { name: "money_imports_format_check", definition: "CHECK (format IN ('revolut_cash_statement_v1'))" },
    ])).toEqual({ provider: true, format: true });
  });

  it("leaves current constraints untouched", () => {
    expect(moneyImportConstraintRepairs([
      { name: "money_accounts_provider_check", definition: "CHECK (provider = ANY (ARRAY['revolut'::text, 'sparkasse'::text]))" },
      { name: "money_imports_format_check", definition: "CHECK (format = ANY (ARRAY['revolut_cash_statement_v1'::text, 'sparkasse_cash_statement_v1'::text]))" },
    ])).toEqual({ provider: false, format: false });
  });
});
