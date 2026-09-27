import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** One page header for every tool: a short title, one line of live facts, and the page actions. */
export function PageHeader({ title, facts, actions, parent }: { title: ReactNode; facts?: ReactNode; actions?: ReactNode; parent?: { label: string; to: string } }) {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold tracking-[-0.01em]">
          {parent ? <><Link className="font-medium text-muted-foreground hover:text-foreground" to={parent.to} preload="intent">{parent.label}</Link><span className="font-medium text-muted-foreground" aria-hidden="true">/</span></> : null}
          {title}
        </h1>
        {facts ? <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{facts}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
