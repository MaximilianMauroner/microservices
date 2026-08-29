import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateEnforcementDetails, CorrectionDetails } from "../field-guide/ui/review-page.js";

describe("mounted decision review correction details", () => {
  it("renders the full correction analysis used by the review panel", () => {
    const html = renderToStaticMarkup(<CorrectionDetails correction={{
      failedInvariant: "Managed sync must preserve files owned by another system.",
      selectedLayer: "skill_or_rule",
      mechanism: "skills/maintain-field-guides/SKILL.md#Correction elimination",
      higherLevelRejections: {
        architecture: "The target has mixed ownership by design.",
        automated_check: "The boundary depends on declared fleet policy.",
      },
    }} />);

    expect(html).toContain("Correction prevention");
    expect(html).toContain("Managed sync must preserve files owned by another system.");
    expect(html).toContain("skill_or_rule");
    expect(html).toContain("skills/maintain-field-guides/SKILL.md#Correction elimination");
    expect(html).toContain("The target has mixed ownership by design.");
    expect(html).toContain("The boundary depends on declared fleet policy.");
  });
});

describe("mounted candidate inspector enforcement details", () => {
  it("renders every structured enforcement and correction field", () => {
    const html = renderToStaticMarkup(<CandidateEnforcementDetails candidate={{
      stance: "rule",
      strength: "advisory",
      preventionLayer: "skill_or_rule",
      mechanism: "skills/maintain-field-guides/SKILL.md#Correction elimination",
      failedInvariant: "Managed sync must preserve declared ownership.",
      higherLevelRejections: {
        architecture: "Mixed ownership is intentional.",
        automated_check: "Fleet policy is not available to a local check.",
      },
    }} />);

    for (const expected of [
      "Enforcement and correction", "Stance", "rule", "Strength", "advisory",
      "Prevention layer", "skill_or_rule", "Mechanism",
      "skills/maintain-field-guides/SKILL.md#Correction elimination",
      "Failed invariant", "Managed sync must preserve declared ownership.",
      "Mixed ownership is intentional.", "Fleet policy is not available to a local check.",
    ]) expect(html).toContain(expected);
  });
});
