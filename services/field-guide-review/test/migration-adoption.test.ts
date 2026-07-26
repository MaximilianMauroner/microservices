import { describe, expect, it } from "vitest";
import {
  BASELINE_COLUMNS,
  BASELINE_CONSTRAINTS,
  validateBaselineColumns,
  validateBaselineConstraints,
  validateSequenceDefault,
  type BaselineConstraint,
} from "../src/postgres-repository.js";

const incompatible = "Cannot adopt an incompatible field-guide schema.";

function compatibleConstraints(): BaselineConstraint[] {
  return BASELINE_CONSTRAINTS.map((constraint) => ({
    ...constraint,
    ...(constraint.checkValues
      ? {
          definition: `CHECK ((value = ANY (ARRAY[${constraint.checkValues
            .map((value) => `'${value}'::text`)
            .join(", ")}]))`,
        }
      : {}),
    deferrable: false,
    initiallyDeferred: false,
    ...(constraint.type === "f"
      ? {
          foreignDeleteAction: "a",
          foreignUpdateAction: "a",
          foreignMatchType: "s",
        }
      : {}),
  }));
}

describe("existing 001 schema adoption", () => {
  it("accepts the exact baseline contract and sequence default", () => {
    expect(() => validateBaselineColumns([...BASELINE_COLUMNS])).not.toThrow();
    expect(() => validateBaselineConstraints(compatibleConstraints())).not.toThrow();
    expect(() =>
      validateSequenceDefault({
        defaultExpression:
          "nextval('public.verdict_events_sequence_seq'::regclass)",
        serialSequence: "public.verdict_events_sequence_seq",
        defaultMatchesSerial: true,
      }),
    ).not.toThrow();
  });

  it("rejects a missing or unrelated sequence default", () => {
    expect(() =>
      validateSequenceDefault({
        defaultExpression: null,
        serialSequence: null,
        defaultMatchesSerial: false,
      }),
    ).toThrow(incompatible);
    expect(() =>
      validateSequenceDefault({
        defaultExpression: "nextval('unrelated_sequence'::regclass)",
        serialSequence: "public.verdict_events_sequence_seq",
        defaultMatchesSerial: false,
      }),
    ).toThrow(incompatible);
  });

  it("does not accept a same-named constraint from another table", () => {
    const constraints = compatibleConstraints().filter(
      (constraint) =>
        !(
          constraint.tableName === "candidates" &&
          constraint.name === "candidates_pkey"
        ),
    );
    constraints.push({
      ...compatibleConstraints()[0]!,
      tableName: "unrelated_table",
    });
    expect(() => validateBaselineConstraints(constraints)).toThrow(incompatible);
  });

  it("rejects missing foreign-key and check constraints", () => {
    for (const missing of [
      "review_rounds_candidate_id_fkey",
      "application_receipts_result_check",
    ]) {
      expect(() =>
        validateBaselineConstraints(
          compatibleConstraints().filter(
            (constraint) => constraint.name !== missing,
          ),
        ),
      ).toThrow(incompatible);
    }
  });

  it("rejects a partial or manually altered column set", () => {
    expect(() =>
      validateBaselineColumns(
        BASELINE_COLUMNS.filter(
          (column) => column.columnName !== "next_review_at",
        ),
      ),
    ).toThrow(incompatible);
    expect(() =>
      validateBaselineColumns(
        BASELINE_COLUMNS.map((column) =>
          column.tableName === "verdict_events" &&
          column.columnName === "sequence"
            ? { ...column, dataType: "integer" }
            : column,
        ),
      ),
    ).toThrow(incompatible);
  });
});
