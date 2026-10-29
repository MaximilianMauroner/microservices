// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownPreview } from "./markdown-preview.js";
import { describe, expect, it } from "vitest";

function render(markdown: string): string {
  return renderToStaticMarkup(
    <MarkdownPreview source={markdown} />,
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


describe("document preview", () => {
  function preview(source: string) {
    const container = document.createElement("div");
    container.innerHTML = render(source);
    return container;
  }

  it("renders CommonMark headings, lists, emphasis, quotes, links and code", () => {
    const output = preview([
      "# Heading one", "", "## Heading two", "", "### Heading three", "", "#### Heading four", "", "##### Heading five", "", "###### Heading six", "",
      "A paragraph with **bold**, *emphasis* and `inline code`.", "", "A second paragraph.", "",
      "1. First item", "2. Second item", "   - Nested item", "", "> A quote", "",
      "[A link](https://example.com)", "", "---", "", "```js", "const html = '<script>';", "```",
    ].join("\n"));
    expect(output.querySelectorAll("h1,h2,h3,h4,h5,h6")).toHaveLength(6);
    expect(output.querySelector("strong")?.textContent).toBe("bold");
    expect(output.querySelector("em")?.textContent).toBe("emphasis");
    expect(output.querySelector("ol > li > ul > li")?.textContent).toBe("Nested item");
    expect(output.querySelector("blockquote p")?.textContent).toBe("A quote");
    expect(output.querySelector("a")?.href).toBe("https://example.com/");
    expect(output.querySelector("pre code.language-js")?.textContent).toBe("const html = '<script>';\n");
    expect(output.querySelector("hr")).not.toBeNull();
    expect(output.querySelectorAll("script")).toHaveLength(0);
  });

  it("renders GFM tables with alignment, tasks, deleted text, autolinks and footnotes", () => {
    const output = preview([
      "| Name | Count |", "| :--- | ---: |", "| Item | 12 |", "",
      "- [x] Done", "- [ ] Open", "", "~~Removed~~ and https://example.com", "",
      "A reference[^note].", "", "[^note]: Footnote body.",
    ].join("\n"));
    expect(output.querySelector('[role="region"] table')).not.toBeNull();
    expect(output.querySelectorAll("th")[1]?.style.textAlign).toBe("right");
    expect(output.querySelectorAll("td")[1]?.textContent).toBe("12");
    const tasks = output.querySelectorAll<HTMLInputElement>('.task-list-item input');
    expect(tasks).toHaveLength(2);
    expect(tasks[0].checked).toBe(true);
    expect(tasks[1].checked).toBe(false);
    expect([...tasks].every(task => task.disabled)).toBe(true);
    expect(output.querySelector("del")?.textContent).toBe("Removed");
    expect(output.querySelector('a[href="https://example.com"]')).not.toBeNull();
    expect(output.querySelector(".footnotes")?.textContent).toContain("Footnote body.");
  });

  it("keeps raw HTML and unsafe URLs inert while preserving Unicode and hard breaks", () => {
    const output = preview('Hello 世界 👋  \nNext line\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert%281%29)\n\n![Image](https://example.com/image.png "Caption")');
    expect(output.textContent).toContain("Hello 世界 👋");
    expect(output.querySelector("br")).not.toBeNull();
    expect(output.querySelector("script")).toBeNull();
    expect(output.querySelector("a")?.getAttribute("href")).not.toMatch(/^javascript:/);
    expect(output.querySelector("img")?.alt).toBe("Image");
    expect(output.querySelector("img")?.title).toBe("Caption");
  });
});
