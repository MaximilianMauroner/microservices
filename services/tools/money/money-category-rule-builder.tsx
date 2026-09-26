"use client";

import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { MONEY_CATEGORIES, type MoneyCategory } from "./money-enums.js";
import type { MoneyCategoryRulePreview } from "./money-repository.js";
import { Button } from "../src/components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../src/components/ui/card.js";
import { Input } from "../src/components/ui/input.js";

type Field = "description" | "mcc" | "source_type";

export function MoneyCategoryRuleBuilder({ accounts, accountLabels }: { accounts: readonly string[]; accountLabels: Readonly<Record<string, string>> }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [matchField, setMatchField] = useState<Field>("description");
  const [matchValue, setMatchValue] = useState("");
  const [category, setCategory] = useState<MoneyCategory>("uncategorized");
  const [preview, setPreview] = useState<MoneyCategoryRulePreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const invalidate = () => { setPreview(undefined); setSuccess(undefined); };
  const payload = { accountId, matchField, matchValue, category };
  const submit = async (action: "previewRule" | "createRule") => {
    setBusy(true); setError(undefined); setSuccess(undefined);
    try {
      const response = await fetch("/api/money/categories", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload, ...(action === "createRule" ? { expectedMatchCount: preview?.matchCount } : {}) })
      });
      const result = await response.json() as MoneyCategoryRulePreview & { message?: string; affectedCount?: number };
      if (!response.ok) throw new Error(result.message ?? `Rule request failed (${response.status}).`);
      if (action === "previewRule") setPreview(result);
      else {
        setPreview(undefined);
        setSuccess(`Rule saved. ${result.affectedCount ?? 0} existing rows changed.`);
        await router.invalidate();
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The rule could not be saved."); }
    finally { setBusy(false); }
  };
  return <Card>
    <CardHeader className="border-b"><CardTitle>Create a category rule</CardTitle><CardDescription>Match an exact description, merchant category code, or source type within one account. Preview all matching spending rows before saving.</CardDescription></CardHeader>
    <CardContent className="space-y-4 pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Account
          <select className="w-full rounded-md border border-input bg-background px-3 py-2" value={accountId} disabled={busy} onChange={(event) => { setAccountId(event.target.value); invalidate(); }}>
            <option value="">Select account</option>{accounts.map((id) => <option key={id} value={id}>{accountLabels[id] ?? id}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">Match field
          <select className="w-full rounded-md border border-input bg-background px-3 py-2" value={matchField} disabled={busy} onChange={(event) => { setMatchField(event.target.value as Field); invalidate(); }}>
            <option value="description">Exact description</option><option value="mcc">Merchant category code</option><option value="source_type">Source type</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">Exact value
          <Input value={matchValue} maxLength={250} disabled={busy} onChange={(event) => { setMatchValue(event.target.value); invalidate(); }} placeholder={matchField === "mcc" ? "e.g. 5411" : "As shown in a transaction"} />
        </label>
        <label className="space-y-1 text-sm">Category
          <select className="w-full rounded-md border border-input bg-background px-3 py-2" value={category} disabled={busy} onChange={(event) => { setCategory(event.target.value as MoneyCategory); invalidate(); }}>
            <option value="uncategorized">Select category</option>{MONEY_CATEGORIES.filter((item) => item !== "uncategorized").map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
          </select>
        </label>
      </div>
      <Button type="button" variant="outline" disabled={busy || !accountId || !matchValue.trim() || category === "uncategorized"} onClick={() => void submit("previewRule")}>Preview matches</Button>
      {error ? <p role="alert" className="text-sm text-negative">{error}</p> : null}
      {success ? <p role="status" className="text-sm text-positive">{success}</p> : null}
      {preview ? <div className="space-y-3 rounded-md border p-3 text-sm">
        <p><strong>{preview.matchCount}</strong> historical matches · <strong>{preview.changeCount}</strong> category changes · <strong>{preview.manualCount}</strong> manual choices kept</p>
        {preview.examples.length ? <div className="max-h-64 divide-y overflow-auto">{preview.examples.map((row) => <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 py-2" key={row.id}><span>{row.date}</span><span className="truncate" title={row.description}>{row.description}</span><span>{row.category.replaceAll("_", " ")}{row.categoryOrigin === "manual" ? " · manual" : ""}</span></div>)}</div> : <p>No matching spending rows. Check the exact value and account.</p>}
        {preview.matchCount > preview.examples.length ? <p>Showing the 20 newest matches.</p> : null}
        <Button type="button" disabled={busy || preview.matchCount === 0} onClick={() => void submit("createRule")}>Save rule and apply to matches</Button>
      </div> : null}
    </CardContent>
  </Card>;
}
