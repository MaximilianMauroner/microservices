"use client";

import { EChartsSankeyChart, type ChartConfig } from "../src/components/evilcharts/charts/echarts-sankey-chart.js";
import type { MoneyTrackerAccountCategory } from "./money-tracker-domain.js";

export type AllocationSankeyAccount = Readonly<{
  name: string;
  value: number;
  category: MoneyTrackerAccountCategory;
}>;

type AllocationNode = Readonly<{
  name: string;
  label: string;
  color: string;
  kind: "category" | "account";
  share: number;
}>;

type AllocationSankeyData = Readonly<{
  nodes: AllocationNode[];
  links: Array<Readonly<{ source: number; target: number; value: number }>>;
}>;

const categoryDetails = {
  money: { label: "Cash", color: "#67e8f9" },
  stocks: { label: "Stocks", color: "#c084fc" }
} as const;

const preciseCurrency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** Renders current positive account balances as interactive account → asset class flows. */
export function AllocationSankey({ accounts }: { accounts: readonly AllocationSankeyAccount[] }) {
  const data = buildAllocationSankeyData(accounts);
  const total = data.links.reduce((sum, link) => sum + link.value, 0);
  const categories = data.nodes.filter((node) => node.kind === "category");

  if (!data.links.length) {
    return <div className="grid h-72 place-items-center rounded-md border border-dashed bg-[#050505] text-sm text-muted-foreground">No positive balances to allocate.</div>;
  }

  const config = Object.fromEntries(data.nodes.map((node) => [node.name, {
    label: node.label,
    colors: { light: [node.color], dark: [node.color] }
  }])) satisfies ChartConfig;

  return <div className="space-y-4">
    <div className="space-y-2 px-4 sm:px-0">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {categories.map((category) => <span key={category.name} className="font-mono" style={{ color: category.color }}>{category.label} {preciseCurrency.format(total * category.share / 100)} · {category.share.toFixed(1)}%</span>)}
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {categories.map((category) => <div key={category.name} style={{ width: `${category.share}%`, backgroundColor: category.color }} />)}
      </div>
    </div>
    <div role="img" aria-label={`Allocation of ${preciseCurrency.format(total)} across ${data.nodes.filter((node) => node.kind === "account").length} accounts. ${categories.map((category) => `${category.label} ${category.share.toFixed(1)} percent`).join(", ")}.`}>
      <EChartsSankeyChart
        data={data}
        config={config}
        className="h-[32rem] min-h-[28rem] w-full"
        nodeWidth={132}
        nodePadding={18}
        linkCurvature={0.56}
        iterations={48}
        animation={false}
      >
        <EChartsSankeyChart.Node isClickable radius={7}>
          <EChartsSankeyChart.NodeLabel position="inside" showValues valueFormatter={(value) => `${preciseCurrency.format(value)} · ${(value / total * 100).toFixed(1)}%`} />
        </EChartsSankeyChart.Node>
        <EChartsSankeyChart.Link variant="gradient" />
        <EChartsSankeyChart.Tooltip variant="default" roundness="md" position="variable" />
      </EChartsSankeyChart>
    </div>
    <p className="px-4 text-xs text-muted-foreground sm:px-0">Select a node to isolate its direct allocation path. Zero and negative balances remain available in the account table below.</p>
  </div>;
}

export function buildAllocationSankeyData(accounts: readonly AllocationSankeyAccount[]): AllocationSankeyData {
  const included = accounts
    .filter((account) => account.value > 0)
    .sort((left, right) => left.category.localeCompare(right.category) || right.value - left.value);
  if (!included.length) return { nodes: [], links: [] };

  const activeCategories = (["money", "stocks"] as const).filter((category) => included.some((account) => account.category === category));
  const total = included.reduce((sum, account) => sum + account.value, 0);
  const nodes: AllocationNode[] = [
    ...included.map((account) => ({
      name: `account:${account.name}`,
      label: account.name,
      color: categoryDetails[account.category].color,
      kind: "account" as const,
      share: account.value / total * 100
    })),
    ...activeCategories.map((category) => {
      const value = included.filter((account) => account.category === category).reduce((sum, account) => sum + account.value, 0);
      return {
        name: `category:${category}`,
        label: categoryDetails[category].label,
        color: categoryDetails[category].color,
        kind: "category" as const,
        share: value / total * 100
      };
    })
  ];
  const firstCategoryIndex = included.length;
  const categoryIndex = new Map(activeCategories.map((category, index) => [category, firstCategoryIndex + index]));
  const links = included.map((account, index) => ({ source: index, target: categoryIndex.get(account.category)!, value: account.value }));
  return { nodes, links };
}
