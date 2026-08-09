type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  data?: Record<string, unknown>;
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
};

const BLOCK_CONTAINERS = new Set(["root", "blockquote", "listItem"]);

export function remarkPreserveExtraBlankLines() {
  return (tree: MarkdownNode, file: { value: unknown }): void => {
    if (typeof file.value !== "string") {
      return;
    }

    preserveExtraBlankLines(tree, file.value);
  };
}

function preserveExtraBlankLines(node: MarkdownNode, source: string): void {
  if (!node.children?.length) {
    return;
  }

  if (BLOCK_CONTAINERS.has(node.type)) {
    const children: MarkdownNode[] = [];

    for (const [index, child] of node.children.entries()) {
      children.push(child);

      const next = node.children[index + 1];
      const endOffset = child.position?.end.offset;
      const startOffset = next?.position?.start.offset;
      if (endOffset === undefined || startOffset === undefined) {
        continue;
      }

      const newlineCount = countNewlines(source.slice(endOffset, startOffset));
      for (let blankLine = 0; blankLine < newlineCount - 2; blankLine += 1) {
        children.push(createBlankLine());
      }
    }

    node.children = children;
  }

  for (const child of node.children) {
    preserveExtraBlankLines(child, source);
  }
}

function countNewlines(value: string): number {
  return value.match(/\n/g)?.length ?? 0;
}

function createBlankLine(): MarkdownNode {
  return {
    type: "paragraph",
    children: [],
    data: {
      hName: "div",
      hProperties: {
        ariaHidden: "true",
        className: ["markdown-spacer"],
      },
    },
  };
}
