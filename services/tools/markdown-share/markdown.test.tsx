import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { remarkPreserveExtraBlankLines } from "./markdown.js";

function render(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkPreserveExtraBlankLines]}>
      {markdown}
    </ReactMarkdown>,
  );
}

describe("extra Markdown blank lines", () => {
  it("keeps standard paragraph spacing unchanged", () => {
    expect(render("First\n\nSecond")).not.toContain("markdown-spacer");
  });

  it("renders a second blank source line as visible space", () => {
    const output = render("First\n\n\nSecond");

    expect(output).toContain(
      '<div aria-hidden="true" class="markdown-spacer"></div>',
    );
  });

  it("preserves each additional blank source line", () => {
    const output = render("First\n\n\n\nSecond");

    expect(output.match(/markdown-spacer/g)).toHaveLength(2);
  });
});
