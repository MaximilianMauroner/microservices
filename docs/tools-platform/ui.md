# Tools UI components

Tools uses one shadcn setup for every product. The configuration lives in
`services/tools/components.json`; the components are vendored, not installed
from a package.

## Where components live

- `services/tools/platform/ui/components/ui` holds the shadcn primitives.
- `services/tools/platform/ui/components` holds shared composition that more
  than one product uses, such as `app-shell`, `segmented`, and `page-header`.
- `services/tools/platform/ui/lib` holds shared helpers such as `cn` and
  `count-label`.
- A product keeps its own composition in `services/tools/products/<name>`.

`components.json` maps the shadcn aliases onto that layout:

| Alias | Resolves to |
| --- | --- |
| `@/components` | `platform/ui/components` |
| `@/components/ui` | `platform/ui/components/ui` |
| `@/lib` | `platform/ui/lib` |
| `@/hooks` | `platform/ui/components/ui` |

The `@/*` path in `services/tools/tsconfig.json` makes those aliases resolve.
Hooks live beside the primitives, which is why `@/hooks` points at
`components/ui`; `use-mobile` is the current example.

## Import rules

Import a primitive through its alias, without a file extension:

```ts
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
```

This matches the imports inside the generated components and the output of the
shadcn CLI. Older product files use deep relative paths with a `.js` suffix;
both resolve, but new code uses the alias. The Money product is the reference
implementation.

Do not fork a primitive into a product. Wrap it, or add the shared composition
to `platform/ui/components` when a second product needs it.

## Adding a component

Run the CLI from `services/tools` so it reads `components.json`:

```bash
pnpm dlx shadcn@latest add <component>
```

Then check that the new file imports through `@/components/ui` and `@/lib`, and
that any hook it needs lands in `platform/ui/components/ui`.

## Product composition

Products may build their own layout on top of the primitives. Money is the
largest example: `MoneyPanel` wraps `Card`, `EmptyState` wraps `Empty`, and
`MoneyTable` wraps the shadcn table primitives so the compact money styling
stays in one place. The activity, review, and plan views use the shared
`Checkbox`, `RadioGroup`, and `Slider` primitives. The dashboard charts are a
product-specific SVG layer in `money-ui.tsx`. That layer is intentional: it
keeps chart text sharp, owns the tooltip behaviour, and avoids pulling recharts
into the overview. The investments view is the one place that uses the shadcn
`chart` primitive and recharts.

When a product needs a new table, empty state, skeleton, or control, start with
the shadcn primitive. Reach for product-specific markup only when the primitive
cannot express the interaction.

## Keeping the registry honest

The vendored set is larger than current usage. Before adding a component, check
whether an unused one already covers the need. `select`, `tabs`,
`toggle-group`, `spinner`, `progress`, and `separator` are installed but not yet
used by a product.
