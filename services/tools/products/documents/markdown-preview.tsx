import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkPreserveExtraBlankLines } from "./markdown.js";

const components: Components = {
  table: ({ node: _node, children, ...props }) => (
    <div className="markdown-table-scroll" role="region" aria-label="Table" tabIndex={0}>
      <table {...props}>{children}</table>
    </div>
  ),
};

export function MarkdownPreview({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkPreserveExtraBlankLines]} components={components}>
      {source}
    </ReactMarkdown>
  );
}
