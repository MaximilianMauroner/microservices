import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CorrectionDetails } from "./review-page.js";

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
