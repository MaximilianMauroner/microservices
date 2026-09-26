"use client";

import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import type { MoneyTrackerPageData } from "../src/protected-data.js";
import { MONEY_TRANSFER_DISPOSITIONS, type MoneyTransferDisposition } from "./money-enums.js";
import type { MoneyTransferRulePreview } from "./money-repository.js";
import {
  MONEY_TRANSFER_RULE_MATCHES,
  MONEY_TRANSFER_RULE_SIGNS,
  type MoneyTransferRuleMatch,
  type MoneyTransferRuleSign,
} from "./money-transfer-inference.js";
import { MoneyCategoryRuleBuilder } from "./money-category-rule-builder.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../src/components/ui/alert-dialog.js";
import { Badge } from "../src/components/ui/badge.js";
import { Button } from "../src/components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../src/components/ui/card.js";
import { Input } from "../src/components/ui/input.js";
import { NativeSelect, NativeSelectOption } from "../src/components/ui/native-select.js";

type RulesViewProps = Pick<
  MoneyTrackerPageData,
  "accounts" | "accountLabels" | "accountRoles" | "categoryRules" | "transferRules" | "transferPairRules" | "transferRuleOptions" | "transferReview"
>;

const MATCH_LABELS: Record<MoneyTransferRuleMatch, string> = {
  any: "Any description",
  equals: "Is exactly",
  starts_with: "Starts with",
  contains: "Contains",
  word: "Contains the word",
};
const SIGN_LABELS: Record<MoneyTransferRuleSign, string> = {
  any: "Incoming and outgoing",
  positive: "Incoming only",
  negative: "Outgoing only",
};
const DISPOSITION_LABELS: Record<MoneyTransferDisposition, string> = {
  internal_transfer: "Own-account transfer",
  income: "Income",
  spend: "Spending",
  refund: "Refund",
  excluded: "Exclude from cash flow",
};

export function MoneyRulesView({
  accounts,
  accountLabels,
  accountRoles,
  categoryRules,
  transferRules,
  transferPairRules,
  transferRuleOptions,
  transferReview,
}: RulesViewProps) {
  const cashAccounts = accounts.filter((account) => accountRoles[account] === "cash");
  const unresolved = transferReview.unresolvedPositiveCount + transferReview.unresolvedNegativeCount;
  return (
    <>
      <section className="grid items-start gap-3 xl:grid-cols-2" aria-label="Category rules">
        <MoneyCategoryRuleBuilder accounts={cashAccounts} accountLabels={accountLabels} />
        <CategoryRulesCard rules={categoryRules} />
      </section>
      <section className="grid items-start gap-3 xl:grid-cols-2" aria-label="Transfer rules">
        <TransferRuleBuilder options={transferRuleOptions} unresolved={unresolved} />
        <TransferRulesCard rules={transferRules} pairRules={transferPairRules} />
      </section>
    </>
  );
}

function CategoryRulesCard({ rules }: { rules: MoneyTrackerPageData["categoryRules"] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string>();
  const [error, setError] = useState<string>();
  const remove = async (ruleId: string) => {
    setDeleting(ruleId);
    setError(undefined);
    try {
      await ruleRequest("/api/money/categories", { ruleId }, "DELETE");
      await router.invalidate();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDeleting(undefined);
    }
  };
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Category rules</CardTitle>
        <CardDescription>Exact matches scoped to one account. Manual categories always win.</CardDescription>
      </CardHeader>
      {error ? <p className="px-4 pt-3 text-xs text-rose-300" role="alert">{error}</p> : null}
      <CardContent className="max-h-[28rem] divide-y overflow-y-auto p-0">
        {rules.map((rule) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5" key={rule.id}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" title={rule.description}>{rule.description}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {rule.accountName} · {formatLabel(rule.category)}
              </p>
            </div>
            <Button type="button" size="sm" variant="ghost" disabled={deleting === rule.id} onClick={() => void remove(rule.id)}>
              {deleting === rule.id ? "Removing…" : "Remove"}
            </Button>
          </div>
        ))}
        {!rules.length ? <EmptyRules title="No category rules" description="Create one with the form, or when you change a transaction category." /> : null}
      </CardContent>
    </Card>
  );
}

function TransferRuleBuilder({ options, unresolved }: { options: MoneyTrackerPageData["transferRuleOptions"]; unresolved: number }) {
  const router = useRouter();
  const [provider, setProvider] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [descriptionMatch, setDescriptionMatch] = useState<MoneyTransferRuleMatch>("any");
  const [matchValue, setMatchValue] = useState("");
  const [amountSign, setAmountSign] = useState<MoneyTransferRuleSign>("any");
  const [disposition, setDisposition] = useState<MoneyTransferDisposition>("internal_transfer");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<MoneyTransferRulePreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const providers = [...new Set(options.map((option) => option.provider))];
  const sourceTypes = options.filter((option) => !provider || option.provider === provider);
  const scoped = Boolean(provider || sourceType || (descriptionMatch !== "any" && matchValue.trim()));
  const change = <Value,>(set: (value: Value) => void) => (value: Value) => {
    set(value);
    setPreview(undefined);
    setSuccess(undefined);
  };
  const rule = { provider, sourceType, descriptionMatch, matchValue: descriptionMatch === "any" ? "" : matchValue, amountSign, disposition, note };
  const submit = async (action: "previewRule" | "createRule") => {
    setBusy(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      if (action === "previewRule") {
        setPreview(await ruleRequest<MoneyTransferRulePreview>("/api/money/transfer-rules", { action, ...rule }));
        return;
      }
      const result = await ruleRequest<{ affectedCount: number }>("/api/money/transfer-rules", { action, ...rule, expectedMatchCount: preview?.matchCount });
      setPreview(undefined);
      setSuccess(`Rule saved. ${result.affectedCount} unresolved ${result.affectedCount === 1 ? "row was" : "rows were"} classified.`);
      await router.invalidate();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Create a transfer rule</CardTitle>
        <CardDescription>
          Classifies transfers that stay unresolved after pairing. New rules are checked first. Rows you already reviewed stay unchanged.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {unresolved ? (
          <p className="text-sm">
            <strong>{unresolved.toLocaleString("en-GB")}</strong> transfer rows are unresolved.{" "}
            <Link className="underline underline-offset-4" to="/money" search={{ view: "transactions", review: true }}>
              Review them
            </Link>
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provider">
            <NativeSelect className="w-full" value={provider} disabled={busy} onChange={(event) => { change(setProvider)(event.currentTarget.value); setSourceType(""); }}>
              <NativeSelectOption value="">Any provider</NativeSelectOption>
              {providers.map((item) => <NativeSelectOption key={item} value={item}>{formatLabel(item)}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          <Field label="Statement type">
            <NativeSelect className="w-full" value={sourceType} disabled={busy} onChange={(event) => change(setSourceType)(event.currentTarget.value)}>
              <NativeSelectOption value="">Any type</NativeSelectOption>
              {[...new Set(sourceTypes.map((option) => option.sourceType))].map((item) => {
                const unresolvedCount = sourceTypes.filter((option) => option.sourceType === item).reduce((sum, option) => sum + option.unresolvedCount, 0);
                return <NativeSelectOption key={item} value={item}>{item}{unresolvedCount ? ` · ${unresolvedCount} unresolved` : ""}</NativeSelectOption>;
              })}
            </NativeSelect>
          </Field>
          <Field label="Description">
            <NativeSelect className="w-full" value={descriptionMatch} disabled={busy} onChange={(event) => change(setDescriptionMatch)(event.currentTarget.value as MoneyTransferRuleMatch)}>
              {MONEY_TRANSFER_RULE_MATCHES.map((item) => <NativeSelectOption key={item} value={item}>{MATCH_LABELS[item]}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          <Field label="Text">
            <Input value={descriptionMatch === "any" ? "" : matchValue} maxLength={250} disabled={busy || descriptionMatch === "any"} placeholder={descriptionMatch === "any" ? "Not needed" : "Not case-sensitive"} onChange={(event) => change(setMatchValue)(event.currentTarget.value)} />
          </Field>
          <Field label="Direction">
            <NativeSelect className="w-full" value={amountSign} disabled={busy} onChange={(event) => change(setAmountSign)(event.currentTarget.value as MoneyTransferRuleSign)}>
              {MONEY_TRANSFER_RULE_SIGNS.map((item) => <NativeSelectOption key={item} value={item}>{SIGN_LABELS[item]}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          <Field label="Classify as">
            <NativeSelect className="w-full" value={disposition} disabled={busy} onChange={(event) => change(setDisposition)(event.currentTarget.value as MoneyTransferDisposition)}>
              {MONEY_TRANSFER_DISPOSITIONS.map((item) => <NativeSelectOption key={item} value={item}>{DISPOSITION_LABELS[item]}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          <Field label="Name (optional)" className="sm:col-span-2">
            <Input value={note} maxLength={200} disabled={busy} placeholder="For example: Savings top-ups" onChange={(event) => change(setNote)(event.currentTarget.value)} />
          </Field>
        </div>
        {!scoped ? <p className="text-xs text-muted-foreground">Choose a provider, statement type, or description text.</p> : null}
        <Button type="button" variant="outline" disabled={busy || !scoped} onClick={() => void submit("previewRule")}>
          Preview matches
        </Button>
        {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
        {success ? <p role="status" className="text-sm text-emerald-300">{success}</p> : null}
        {preview ? (
          <div className="space-y-3 rounded-md border p-3 text-sm">
            <p>
              <strong>{preview.matchCount}</strong> unresolved {preview.matchCount === 1 ? "transfer matches" : "transfers match"}. Future imports use the rule too.
            </p>
            {preview.examples.length ? (
              <div className="max-h-64 divide-y overflow-auto">
                {preview.examples.map((row) => (
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 py-2" key={row.id}>
                    <span className="text-muted-foreground">{row.date}</span>
                    <span className="min-w-0">
                      <span className="block truncate" title={row.description}>{row.description}</span>
                      <span className="block truncate text-xs text-muted-foreground">{row.accountName}</span>
                    </span>
                    <span className="font-mono">{formatAmount(row.amountMinor, row.currency)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {preview.matchCount > preview.examples.length ? <p className="text-xs text-muted-foreground">Showing the 20 newest matches.</p> : null}
            <Button type="button" disabled={busy} onClick={() => void submit("createRule")}>
              {preview.matchCount ? `Save rule and classify ${preview.matchCount}` : "Save rule for future imports"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TransferRulesCard({ rules, pairRules }: { rules: MoneyTrackerPageData["transferRules"]; pairRules: MoneyTrackerPageData["transferPairRules"] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string>();
  const [error, setError] = useState<string>();
  const remove = async (ruleId: string) => {
    setDeleting(ruleId);
    setError(undefined);
    try {
      await ruleRequest("/api/money/transfer-rules", { ruleId }, "DELETE");
      await router.invalidate();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDeleting(undefined);
    }
  };
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Transfer rules</CardTitle>
        <CardDescription>Checked from top to bottom. The first matching rule decides.</CardDescription>
      </CardHeader>
      {error ? <p className="px-4 pt-3 text-xs text-rose-300" role="alert">{error}</p> : null}
      <CardContent className="max-h-[36rem] divide-y overflow-y-auto p-0">
        {pairRules.map((rule) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5" key={rule.id}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">Pair card funding · {formatLabel(rule.creditProvider)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatLabel(rule.debitProvider)} {rule.debitSourceType} naming “{rule.debitMatchValue}” → {formatLabel(rule.creditProvider)} {rule.creditSourceType} on the purchase date
              </p>
            </div>
            <Badge variant="outline">pair</Badge>
          </div>
        ))}
        {rules.map((rule) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5" key={rule.id}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" title={rule.note ?? transferRuleSummary(rule)}>{rule.note ?? transferRuleSummary(rule)}</p>
              {rule.note ? <p className="mt-0.5 truncate text-xs text-muted-foreground" title={transferRuleSummary(rule)}>{transferRuleSummary(rule)}</p> : null}
            </div>
            <Badge variant="outline">{DISPOSITION_LABELS[rule.disposition]}</Badge>
            <AlertDialog>
              <AlertDialogTrigger render={<Button type="button" size="sm" variant="ghost" disabled={deleting !== undefined} />}>
                {deleting === rule.id ? "Removing…" : "Remove"}
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this transfer rule?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Future imports stop using “{rule.note ?? transferRuleSummary(rule)}”. Transfers it already classified keep their classification.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void remove(rule.id)}>Remove rule</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ))}
        {!rules.length && !pairRules.length ? <EmptyRules title="No transfer rules" description="Unresolved transfers wait for review until a rule matches them." /> : null}
      </CardContent>
    </Card>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`space-y-1 text-sm ${className}`}>
      <span className="block">{label}</span>
      {children}
    </label>
  );
}

function EmptyRules({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-36 place-items-center p-5 text-center">
      <div>
        <p className="font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function transferRuleSummary(rule: MoneyTrackerPageData["transferRules"][number]) {
  const description = rule.descriptionMatch === "any" ? "any description" : `description ${MATCH_LABELS[rule.descriptionMatch].toLowerCase()} “${rule.matchValue}”`;
  const sign = rule.amountSign === "any" ? "" : ` · ${SIGN_LABELS[rule.amountSign].toLowerCase()}`;
  return `${rule.provider ? formatLabel(rule.provider) : "Any provider"} · ${rule.sourceType ?? "any type"} · ${description}${sign}`;
}

function formatLabel(value: string) {
  return value.replace(/_v\d$/, "").replaceAll("_", " ");
}

function formatAmount(valueMinor: number, currency: string) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(valueMinor / 100);
}

async function ruleRequest<Result = { ok: true }>(url: string, value: Record<string, unknown>, method = "POST"): Promise<Result> {
  const response = await fetch(url, { method, body: JSON.stringify(value), headers: { "Content-Type": "application/json" } });
  const body = (await response.json()) as { message?: unknown } | Result;
  if (!response.ok) {
    throw new Error(typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : `Rule request failed with status ${response.status}.`);
  }
  return body as Result;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The rule request failed.";
}
