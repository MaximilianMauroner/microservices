"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import type { MoneyTrackerPageData } from "../src/protected-data.js";
import type { MoneyCategoryRuleField, MoneyCategoryRuleOperator } from "./money-category-rules.js";
import type { MoneyCategory } from "./money-enums.js";
import type { MoneyCategoryRule, MoneyCategoryRulePreview } from "./money-repository.js";
import { CategoryValue, MoneyCategoryPicker, moneyCategoryLabel } from "./money-category-picker.js";
import { ruleErrorMessage, ruleRequest } from "./money-rule-request.js";
import { EmptyState, formatDay, MoneyPanel } from "./money-ui.js";
import { countLabel } from "../src/lib/count-label.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../src/components/ui/alert-dialog.js";
import { Button } from "../src/components/ui/button.js";
import { Input } from "../src/components/ui/input.js";
import { NativeSelect, NativeSelectOption } from "../src/components/ui/native-select.js";

type Draft = Readonly<{
  ruleId?: string;
  accountId: string;
  matchField: MoneyCategoryRuleField;
  matchOperator: MoneyCategoryRuleOperator;
  matchValue: string;
  category?: MoneyCategory;
}>;

const EMPTY_DRAFT: Draft = { accountId: "", matchField: "description", matchOperator: "word", matchValue: "" };
const FIELD_LABELS: Record<MoneyCategoryRuleField, string> = { description: "description", mcc: "merchant code", source_type: "statement type" };
const OPERATOR_LABELS: Record<MoneyCategoryRuleOperator, string> = { word: "contains the word", contains: "contains", starts_with: "starts with", equals: "is exactly" };
const OPERATOR_ORDER: readonly MoneyCategoryRuleOperator[] = ["word", "contains", "starts_with", "equals"];
const OPERATOR_HINTS: Record<MoneyCategoryRuleOperator, string> = {
  word: "Whole words only: “bus” matches “Flix Bus 12” but not “Business”.",
  contains: "Any part of the text: “caf” matches “Café Central” and “Billardcafe”.",
  starts_with: "The start of the text: “pp*” matches “PP*1234 Shop”.",
  equals: "The whole text and nothing more.",
};
const PLACEHOLDERS: Record<MoneyCategoryRuleField, string> = { description: "billa", mcc: "5411", source_type: "ATM" };
const PREVIEW_DELAY_MS = 250;

/** One ordered rule set: the builder writes rules in the same words the list reads them. */
export function MoneyCategoryRulesPanel({
  rules,
  accounts,
  accountLabels,
  prefill,
}: Readonly<{
  rules: MoneyTrackerPageData["categoryRules"];
  accounts: readonly string[];
  accountLabels: Readonly<Record<string, string>>;
  /** Description text from the review queue. */
  prefill?: string;
}>) {
  const navigate = useNavigate();
  const builder = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft>(prefill ? { ...EMPTY_DRAFT, matchOperator: "equals", matchValue: prefill } : EMPTY_DRAFT);
  const [status, setStatus] = useState<string>();
  useEffect(() => {
    if (prefill) void navigate({ to: "/money", search: { view: "review", tab: "rules" }, replace: true });
  }, [prefill, navigate]);
  const edit = (rule: MoneyCategoryRule) => {
    setStatus(undefined);
    setDraft({ ruleId: rule.id, accountId: rule.accountId ?? "", matchField: rule.matchField, matchOperator: rule.matchOperator, matchValue: rule.matchValue, category: rule.category });
    builder.current?.scrollIntoView({ block: "nearest" });
    // The builder remounts for the edited rule, so focus its new input after the render.
    requestAnimationFrame(() => builder.current?.querySelector("input")?.focus({ preventScroll: true }));
  };
  return (
    <MoneyPanel
      label="Category rules"
      title="Category rules"
      description="Rules run from the top. The first match sets the category, and a saved rule moves to the top. Categories you choose by hand always win."
    >
      <div ref={builder}>
        <RuleBuilder
          key={draft.ruleId ?? "new"}
          draft={draft}
          position={draft.ruleId ? rules.findIndex((rule) => rule.id === draft.ruleId) + 1 : undefined}
          accounts={accounts}
          accountLabels={accountLabels}
          onDraft={(next) => { setDraft(next); setStatus(undefined); }}
          onDone={(message) => { setDraft(EMPTY_DRAFT); setStatus(message); }}
        />
      </div>
      {status ? <p role="status" className="border-t px-4 py-2 text-sm text-positive">{status}</p> : null}
      <RuleList rules={rules} editing={draft.ruleId} onEdit={edit} onRemoved={setStatus} />
    </MoneyPanel>
  );
}

function RuleBuilder({
  draft,
  position,
  accounts,
  accountLabels,
  onDraft,
  onDone,
}: Readonly<{
  draft: Draft;
  position: number | undefined;
  accounts: readonly string[];
  accountLabels: Readonly<Record<string, string>>;
  onDraft: (draft: Draft) => void;
  onDone: (message?: string) => void;
}>) {
  const router = useRouter();
  const [preview, setPreview] = useState<Readonly<{ key: string; result: MoneyCategoryRulePreview }>>();
  const [previewError, setPreviewError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const text = draft.matchValue.trim();
  // Before a category is chosen, the preview only shows which rows match.
  const request = {
    ...(draft.ruleId ? { ruleId: draft.ruleId } : {}),
    ...(draft.accountId ? { accountId: draft.accountId } : {}),
    matchField: draft.matchField,
    matchOperator: draft.matchField === "description" ? draft.matchOperator : "equals",
    matchValue: text,
    category: draft.category ?? "uncategorized",
  };
  const key = JSON.stringify(request);
  const current = preview?.key === key ? preview.result : undefined;

  useEffect(() => {
    setPreviewError(undefined);
    if (!text) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      ruleRequest<MoneyCategoryRulePreview>("/api/money/categories", { action: "previewRule", ...request }, { signal: controller.signal })
        .then((result) => setPreview({ key, result }))
        .catch((caught: unknown) => { if (!controller.signal.aborted) setPreviewError(ruleErrorMessage(caught)); });
    }, PREVIEW_DELAY_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, refresh]); // The key covers every request field.

  const change = (next: Partial<Draft>) => { setSaveError(undefined); onDraft({ ...draft, ...next }); };
  const save = async () => {
    if (!current) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const result = await ruleRequest<{ affectedCount: number }>("/api/money/categories", { action: "saveRule", ...request, expectedMatchCount: current.matchCount });
      await router.invalidate();
      onDone(`Rule saved. ${countLabel(result.affectedCount, "row")} changed category.`);
    } catch (caught) {
      setSaveError(ruleErrorMessage(caught));
      setRefresh((value) => value + 1);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="grid gap-3 px-4 pt-3 pb-4" aria-label={draft.ruleId ? "Edit rule" : "New rule"}>
      <h3 className="text-sm font-medium">{position ? `Edit rule ${position}` : "New rule"}</h3>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        <span>When the</span>
        <NativeSelect size="sm" aria-label="Field to match" value={draft.matchField} disabled={saving}
          onChange={(event) => { const matchField = event.currentTarget.value as MoneyCategoryRuleField; change({ matchField, matchOperator: matchField === "description" ? draft.matchOperator : "equals" }); }}>
          {(["description", "mcc", "source_type"] as const).map((field) => <NativeSelectOption key={field} value={field}>{FIELD_LABELS[field]}</NativeSelectOption>)}
        </NativeSelect>
        {draft.matchField === "description" ? (
          <NativeSelect size="sm" aria-label="How to match" value={draft.matchOperator} disabled={saving} onChange={(event) => change({ matchOperator: event.currentTarget.value as MoneyCategoryRuleOperator })}>
            {OPERATOR_ORDER.map((operator) => <NativeSelectOption key={operator} value={operator}>{OPERATOR_LABELS[operator]}</NativeSelectOption>)}
          </NativeSelect>
        ) : <span>is</span>}
        <Input className="h-8 w-56 max-w-full" aria-label="Text to match" value={draft.matchValue} maxLength={250} disabled={saving} placeholder={PLACEHOLDERS[draft.matchField]}
          inputMode={draft.matchField === "mcc" ? "numeric" : undefined} onChange={(event) => change({ matchValue: event.currentTarget.value })} />
        <span>in</span>
        <NativeSelect size="sm" aria-label="Account" value={draft.accountId} disabled={saving} onChange={(event) => change({ accountId: event.currentTarget.value })}>
          <NativeSelectOption value="">any account</NativeSelectOption>
          {accounts.map((account) => <NativeSelectOption key={account} value={account}>{accountLabels[account] ?? account}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        <span>set the category to</span>
        <MoneyCategoryPicker value={draft.category} disabled={saving} ariaLabel={draft.category ? `Category to set: ${moneyCategoryLabel(draft.category)}` : "Choose the category to set"} onValue={(category) => change({ category })} />
      </div>
      <p className="text-xs text-muted-foreground">
        {draft.matchField === "description" ? `${OPERATOR_HINTS[draft.matchOperator]} ` : ""}
        Case, accents, and extra spaces do not matter.
        {draft.category === "uncategorized" ? " Matching rows stay in the review queue, and rules below this one skip them." : ""}
      </p>
      {text ? <RulePreview preview={current} error={previewError} categoryChosen={draft.category !== undefined} editing={draft.ruleId !== undefined} /> : null}
      {saveError ? <p role="alert" className="text-sm text-negative">{saveError}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={saving || !current || !draft.category} onClick={() => void save()}>
          {saving ? "Saving…" : draft.ruleId ? "Save changes" : "Save rule"}
        </Button>
        {draft.ruleId || text ? <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => onDone()}>{draft.ruleId ? "Cancel" : "Clear"}</Button> : null}
        {text && !draft.category ? <span className="text-xs text-muted-foreground">Choose a category to save the rule.</span> : null}
      </div>
    </section>
  );
}

function RulePreview({ preview, error, categoryChosen, editing }: Readonly<{ preview: MoneyCategoryRulePreview | undefined; error: string | undefined; categoryChosen: boolean; editing: boolean }>) {
  if (error) return <p role="alert" className="text-sm text-negative">{error}</p>;
  if (!preview) return <p className="text-sm text-muted-foreground" aria-live="polite">Finding matching rows…</p>;
  const shown = categoryChosen ? preview.examples : preview.examples.filter((row) => row.matches);
  return (
    <div className="grid gap-2 rounded-lg border" aria-live="polite">
      <p className="px-3 pt-2.5 text-sm">
        <strong className="font-semibold tabular-nums">{countLabel(preview.matchCount, "row")}</strong> {preview.matchCount === 1 ? "matches" : "match"}.{" "}
        {categoryChosen ? <><strong className="font-semibold tabular-nums">{countLabel(preview.changeCount, "row")}</strong> {preview.changeCount === 1 ? "changes" : "change"} category.</> : "Choose a category to see what changes."}
        {preview.manualCount ? <span className="text-muted-foreground"> {countLabel(preview.manualCount, "category", "categories")} chosen by hand {preview.manualCount === 1 ? "stays" : "stay"}.</span> : null}
        {!preview.matchCount ? <span className="text-muted-foreground"> The rule still applies to future imports.</span> : null}
      </p>
      {shown.length ? (
        <div className="max-h-72 overflow-y-auto border-t">
          <table className="money-table">
            <thead className="sticky top-0 z-10 bg-card">
              <tr><th className="hide-sm">Date</th><th>Description</th><th className="num">Amount</th><th>Category</th></tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const changes = categoryChosen && row.nextCategory !== row.category;
                return (
                  <tr key={row.id} className={changes ? undefined : "text-muted-foreground"}>
                    <td className="hide-sm whitespace-nowrap">{formatDay(row.date)}</td>
                    <td className="max-w-80">
                      <span className="block truncate" title={row.description}>{row.description}</span>
                      <span className="sub">{row.accountName}{editing && !row.matches ? ", no longer matches this rule" : ""}</span>
                    </td>
                    <td className="num">{formatAmount(row.amountMinor, row.currency)}</td>
                    <td>
                      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 md:flex-nowrap md:whitespace-nowrap">
                        {changes ? (
                          <>
                            <span className="text-muted-foreground line-through decoration-muted-foreground/60">{moneyCategoryLabel(row.category)}</span>
                            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="to" />
                            <CategoryValue category={row.nextCategory} />
                          </>
                        ) : (
                          <>
                            <CategoryValue category={row.category} />
                            {row.categoryOrigin === "manual" ? <span className="text-xs">chosen by hand</span> : null}
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {preview.matchCount > shown.length && shown.length ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing {shown.length} rows. Rows that change come first, then the newest.</p> : null}
    </div>
  );
}

function RuleList({ rules, editing, onEdit, onRemoved }: Readonly<{ rules: readonly MoneyCategoryRule[]; editing: string | undefined; onEdit: (rule: MoneyCategoryRule) => void; onRemoved: (message: string) => void }>) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MoneyCategory | "">("");
  const [removing, setRemoving] = useState<MoneyCategoryRule>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ordered = useMemo(() => rules.map((rule, index) => ({ rule, position: index + 1, search: ruleSearchText(rule) })), [rules]);
  const categories = useMemo(() => [...new Set(rules.map((rule) => rule.category))].sort((left, right) => moneyCategoryLabel(left).localeCompare(moneyCategoryLabel(right))), [rules]);
  const terms = query.trim().toLocaleLowerCase("en-GB").split(/\s+/).filter(Boolean);
  const shown = ordered.filter((item) => (!category || item.rule.category === category) && terms.every((term) => item.search.includes(term)));
  const remove = async (rule: MoneyCategoryRule) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await ruleRequest<{ affectedCount: number }>("/api/money/categories", { ruleId: rule.id }, { method: "DELETE" });
      await router.invalidate();
      onRemoved(`Rule removed. ${countLabel(result.affectedCount, "row")} changed category.`);
    } catch (caught) {
      setError(ruleErrorMessage(caught));
    } finally {
      setBusy(false);
      setRemoving(undefined);
    }
  };
  return (
    <div className="border-t">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <Input type="search" className="h-8 w-72 max-w-full" aria-label="Find rules" placeholder="Find text, code, category, or account" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <NativeSelect size="sm" aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.currentTarget.value as MoneyCategory | "")}>
          <NativeSelectOption value="">All categories</NativeSelectOption>
          {categories.map((item) => <NativeSelectOption key={item} value={item}>{moneyCategoryLabel(item)}</NativeSelectOption>)}
        </NativeSelect>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{shown.length === rules.length ? countLabel(rules.length, "rule") : `${shown.length} of ${countLabel(rules.length, "rule")}`}</span>
      </div>
      {error ? <p role="alert" className="px-4 pb-2 text-sm text-negative">{error}</p> : null}
      {shown.length ? (
        <div className="max-h-[36rem] overflow-y-auto border-t">
          <table className="money-table">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                <th className="num hide-sm" title="Rules run in this order">Order</th>
                <th>When</th>
                <th>Category</th>
                <th className="num" title="Rows this rule sets the category for">Rows</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ rule, position }) => (
                <tr key={rule.id} aria-selected={rule.id === editing ? true : undefined}>
                  <td className="num hide-sm text-muted-foreground">{position}</td>
                  <td className="max-w-[28rem]">
                    <span className="block md:truncate" title={ruleSentence(rule)}><RuleCondition rule={rule} /></span>
                    {rule.accountName ? <span className="sub">Only in {rule.accountName}</span> : null}
                  </td>
                  <td><CategoryValue category={rule.category} /></td>
                  <td className={`num ${rule.rowCount ? "" : "text-muted-foreground"}`}>{rule.rowCount.toLocaleString("en-GB")}</td>
                  <td className="w-px whitespace-nowrap">
                    <Button type="button" size="icon-xs" variant="ghost" className="max-md:size-8" aria-label={`Edit rule ${position}`} title="Edit" onClick={() => onEdit(rule)}><Pencil /></Button>
                    <Button type="button" size="icon-xs" variant="ghost" className="max-md:size-8" aria-label={`Remove rule ${position}`} title="Remove" disabled={busy} onClick={() => setRemoving(rule)}><Trash2 /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={rules.length ? "No rules match this search" : "No category rules yet"}>
          {rules.length ? "Change the search text or the category filter." : "Write one above, or choose a category for a merchant in the review queue."}
        </EmptyState>
      )}
      <AlertDialog open={removing !== undefined} onOpenChange={(open) => { if (!open && !busy) setRemoving(undefined); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing ? `${ruleSentence(removing)}. ` : ""}
              {removing?.rowCount ? `Its ${countLabel(removing.rowCount, "row")} get the category from the next matching rule, or go back to the review queue.` : "No rows use it now."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={() => { if (removing) void remove(removing); }}>Remove rule</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RuleCondition({ rule }: Readonly<{ rule: MoneyCategoryRule }>) {
  const field = FIELD_LABELS[rule.matchField];
  return (
    <>
      <span className="text-muted-foreground">{capitalize(field)} {rule.matchField === "description" ? OPERATOR_LABELS[rule.matchOperator] : "is"}</span>{" "}
      <span className="font-medium">{rule.matchValue}</span>
    </>
  );
}

function ruleSentence(rule: MoneyCategoryRule) {
  const field = FIELD_LABELS[rule.matchField];
  const operator = rule.matchField === "description" ? OPERATOR_LABELS[rule.matchOperator] : "is";
  return `${capitalize(field)} ${operator} “${rule.matchValue}”${rule.accountName ? ` in ${rule.accountName}` : ""}: ${moneyCategoryLabel(rule.category)}`;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ruleSearchText(rule: MoneyCategoryRule) {
  return `${ruleSentence(rule)} ${rule.matchField} ${rule.category}`.toLocaleLowerCase("en-GB");
}

function formatAmount(valueMinor: number, currency: string) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(valueMinor / 100);
}
