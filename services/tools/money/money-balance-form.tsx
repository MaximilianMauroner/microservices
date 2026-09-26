"use client";

import { useState } from "react";
import { Button } from "../src/components/ui/button.js";
import { Input } from "../src/components/ui/input.js";

/** Saves one balance. Old balances are fixed in the row where they show. */
export function BalanceForm({
  accountId,
  accountName = false,
  label,
  value,
  onDone,
  onCancel,
}: {
  accountId?: string;
  accountName?: boolean;
  label?: string;
  value?: number;
  onDone: () => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/money/balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(accountId ? { accountId } : { accountName: String(form.get("accountName") ?? "") }),
          date: String(form.get("date") ?? ""),
          value: String(form.get("value") ?? "").replace(/\./g, "").replace(",", "."),
          currency: "EUR",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `The balance was not saved (${response.status}).`);
      }
      await onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The balance was not saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="flex flex-wrap items-end gap-2 border-t bg-muted/40 px-4 py-3" onSubmit={(event) => void submit(event)} aria-label={label ? `New balance for ${label}` : "New cash account"}>
      {accountName ? (
        <label className="grid gap-1 text-xs text-muted-foreground">
          Account name
          <Input name="accountName" required maxLength={100} placeholder="Cash account" className="w-48" />
        </label>
      ) : null}
      <label className="grid gap-1 text-xs text-muted-foreground">
        Balance on
        <Input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="w-40" />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Amount in €
        <Input name="value" required inputMode="decimal" autoFocus placeholder="0,00" defaultValue={value === undefined ? undefined : value.toFixed(2).replace(".", ",")} className="w-36 text-right tabular-nums" />
      </label>
      <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Save balance"}</Button>
      {onCancel ? <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button> : null}
      {error ? <p className="w-full text-sm text-negative" role="alert">{error}</p> : null}
    </form>
  );
}

