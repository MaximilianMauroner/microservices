"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { LinkIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { AppShell } from "../src/components/app-shell.js";
import { PageHeader } from "../src/components/page-header.js";
import { Button } from "../src/components/ui/button.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../src/components/ui/dropdown-menu.js";
import { favicons } from "../src/favicons.js";
import { countLabel } from "../src/lib/count-label.js";
import { copyFeedbackText } from "./clipboard.js";
import type { FeedbackForm, FeedbackLanguage } from "./domain.js";
import { createFeedbackForm } from "./server-functions.js";
import { CountBadge, FormStatusBadge, feedbackErrorMessage, formatRecentDay } from "./ui.js";

const LANGUAGE_NAME: Record<FeedbackLanguage, string> = { en: "English", de: "German" };

export function FeedbackFormsPage({ forms, publicOrigin }: { forms: readonly FeedbackForm[]; publicOrigin: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const active = forms.filter((form) => form.status === "active").length;

  async function create(language: FeedbackLanguage) {
    setBusy(true); setError(undefined);
    try {
      const form = await createFeedbackForm({ data: { language } });
      await navigate({ to: "/feedback/forms/$formId", params: { formId: form.id } });
    } catch (caught) { setError(feedbackErrorMessage(caught)); } finally { setBusy(false); }
  }

  return <>
    <AppShell product="Feedback" icon={favicons.feedback} accent="rose" />
    <main id="main" className="tools-page">
      <PageHeader
        title="Forms"
        facts={countLabel(active, "active form")}
        actions={<DropdownMenu>
          <DropdownMenuTrigger render={<Button disabled={busy} />}><PlusIcon data-icon="inline-start" />{busy ? "Creating…" : "New form"}</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => void create("en")}>English form</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void create("de")}>German form</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      />
      {error ? <p className="mb-3 text-sm text-destructive" role="alert">{error}</p> : null}
      <section className="overflow-hidden rounded-xl border bg-card" aria-label="Forms">
        {forms.length ? <table className="w-full border-collapse text-[0.8125rem]">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2.5 pl-4 font-medium">Form</th>
              <th className="px-2.5 py-2 font-medium">Status</th>
              <th className="px-2.5 py-2 text-right font-medium max-sm:hidden">Responses</th>
              <th className="px-2.5 py-2 text-right font-medium max-sm:hidden">Unread</th>
              <th className="px-2.5 py-2 font-medium max-sm:hidden" aria-sort="descending">Updated</th>
              <th className="py-2 pr-4 pl-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {forms.map((form) => <tr key={form.id} className="relative border-b border-border/60 last:border-b-0 hover:bg-muted/70">
              <td className="w-full max-w-0 py-2 pr-2.5 pl-4">
                {/* The link covers the whole row, so the row opens the editor. */}
                <Link to="/feedback/forms/$formId" params={{ formId: form.id }} preload="intent" className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:underline">{form.title || "Untitled form"}</Link>
                <span className="block truncate text-xs text-muted-foreground">
                  {LANGUAGE_NAME[form.language]} · {form.questions.length ? countLabel(form.questions.length, "question") : "no questions"}
                  <span className="sm:hidden"> · {countLabel(form.responseCount, "response")}</span>
                </span>
              </td>
              <td className="px-2.5 py-2"><FormStatusBadge status={form.status} /></td>
              <td className="px-2.5 py-2 text-right tabular-nums max-sm:hidden">{form.responseCount.toLocaleString("en-GB")}</td>
              <td className="px-2.5 py-2 text-right max-sm:hidden">{form.unreadCount ? <CountBadge count={form.unreadCount} /> : <span className="text-muted-foreground">0</span>}</td>
              <td className="px-2.5 py-2 whitespace-nowrap text-muted-foreground max-sm:hidden" suppressHydrationWarning>{formatRecentDay(form.updatedAt)}</td>
              <td className="py-2 pr-4 pl-2.5 text-right">
                {form.status === "active" ? <Button className="relative z-10" size="icon-sm" variant="ghost" aria-label={`Copy public link for ${form.title || "Untitled form"}`} title="Copy public link" onClick={() => void copyFeedbackText(`${publicOrigin}/feedback/f/${form.publicToken}`, "Link copied")}><LinkIcon /></Button> : null}
              </td>
            </tr>)}
          </tbody>
        </table> : <div className="px-4 py-12 text-center">
          <p className="font-medium">No forms yet</p>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">Use New form to make an empty form in English or German.</p>
        </div>}
      </section>
    </main>
  </>;
}
