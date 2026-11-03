import { useRouter } from "@tanstack/react-router";
import { FileSpreadsheetIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../platform/ui/components/ui/button.js";
import { Input } from "../../../platform/ui/components/ui/input.js";
import { toast } from "../../../platform/ui/components/ui/toast.js";
import type { getBodyshopSettings } from "../server-functions.js";
import type { ImportPreview, ImportReceipt } from "../service.js";
import type { SettingKey } from "../settings.js";
import { BodyshopPage, Field, fmt, numberOrNull, useBodyshopAction } from "./kit.js";

type Data = Awaited<ReturnType<typeof getBodyshopSettings>>;

const TARGETS: readonly SettingKey[] = ["calorieTarget", "proteinTarget", "carbTarget", "fatTarget", "fiberTarget", "goalLow", "goalHigh", "rateTargetPercent"];

export function SettingsPage({ data }: { data: Data }) {
  return (
    <BodyshopPage title="Settings" facts="Targets, model settings, and the import from your Eating workbook.">
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <SettingsForm data={data} keys={TARGETS} title="Targets" />
        <ImportCard data={data} />
        <details className="rounded-2xl border border-(--surface-border) bg-card lg:col-span-2">
          <summary className="cursor-pointer px-4 py-3 font-semibold">Model settings</summary>
          <div className="border-t border-(--surface-border) p-4">
            <SettingsForm data={data} keys={(Object.keys(data.labels) as SettingKey[]).filter((key) => !TARGETS.includes(key))} plain />
          </div>
        </details>
      </div>
    </BodyshopPage>
  );
}

function SettingsForm({ data, keys, title, plain }: { data: Data; keys: readonly SettingKey[]; title?: string; plain?: boolean }) {
  const { run, pending } = useBodyshopAction();
  const [values, setValues] = useState(() => Object.fromEntries(keys.map((key) => [key, String(data.settings[key])])) as Record<SettingKey, string>);
  const changed = keys.filter((key) => numberOrNull(values[key]) !== null && numberOrNull(values[key]) !== data.settings[key]);
  const form = (
    <form className="grid gap-3" onSubmit={(event) => {
      event.preventDefault();
      void run({ type: "settings.update", values: Object.fromEntries(changed.map((key) => [key, numberOrNull(values[key])!])) as Record<SettingKey, number> }, "Settings saved");
    }}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {keys.map((key) => (
          <Field key={key} label={data.labels[key]} hint={data.rows.find((row) => row.label.toLowerCase() === data.labels[key].toLowerCase())?.unit}>
            <Input inputMode="decimal" value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
          </Field>
        ))}
      </div>
      <div><Button type="submit" disabled={pending || !changed.length}>Save {changed.length ? `${changed.length} change${changed.length > 1 ? "s" : ""}` : ""}</Button></div>
    </form>
  );
  if (plain) return form;
  return (
    <section className="rounded-2xl border border-(--surface-border) bg-card p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {form}
    </section>
  );
}

async function send(path: string, form: FormData): Promise<unknown> {
  const response = await fetch(path, { method: "POST", body: form, credentials: "same-origin" });
  const body = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(body.message ?? "The workbook could not be read.");
  return body;
}

function ImportCard({ data }: { data: Data }) {
  const router = useRouter();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<ImportPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function check(chosen: File) {
    setFile(chosen); setPreview(undefined); setError(undefined); setBusy(true);
    const form = new FormData();
    form.set("file", chosen);
    try { setPreview(await send("/api/bodyshop/import/preview", form) as ImportPreview); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } finally { setBusy(false); }
  }
  async function commit() {
    if (!file || !preview) return;
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    form.set("expectedDigest", preview.digest);
    form.set("expectedChangeMark", preview.changeMark);
    try {
      const result = await send("/api/bodyshop/import", form) as { receipt: ImportReceipt; replay: boolean };
      toast.add({ title: result.replay ? "This file was imported before" : "Workbook imported", description: `${result.receipt.records.entry} food entries, ${result.receipt.records.weight} weights.`, type: "success" });
      setPreview(undefined); setFile(undefined);
      await router.invalidate();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setBusy(false); }
  }

  const rec = preview?.reconciliation;
  return (
    <section className="grid gap-3 rounded-2xl border border-(--surface-border) bg-card p-4">
      <h2 className="flex items-center gap-2 font-semibold"><FileSpreadsheetIcon className="size-4 text-muted-foreground" aria-hidden />Import the Eating workbook</h2>
      <p className="text-sm text-muted-foreground">
        In Google Sheets choose File, Download, Microsoft Excel (.xlsx), then pick the file here. Bodyshop checks it first and writes nothing until you import.
        A new import replaces the records of earlier imports. Food and weights you logged in Bodyshop stay.
      </p>
      <Input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Workbook" disabled={busy}
        onChange={(event) => { const chosen = event.target.files?.[0]; if (chosen) void check(chosen); }} />
      {busy && !preview ? <p className="text-sm text-muted-foreground">Reading the workbook…</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {preview && rec ? (
        <div className="grid gap-3 text-sm">
          <p>
            <strong className="font-semibold">{rec.matchingDays} of {rec.days} days</strong> match the Daily sheet,
            and <strong className="font-semibold">{rec.matchingWeights} of {rec.weights} days</strong> match the weight trend.
          </p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground sm:grid-cols-3">
            {preview.sheets.map((sheet) => <li key={sheet.sheet}>{sheet.sheet}: {sheet.imported}{sheet.skipped.length ? ` (${sheet.skipped.length} skipped)` : ""}</li>)}
          </ul>
          {preview.errors.length ? (
            <div role="alert" className="rounded-lg border border-destructive/50 p-3">
              <p className="font-semibold text-destructive">Fix these in the sheet first</p>
              <ul className="mt-1 list-disc pl-5">{preview.errors.slice(0, 20).map((note) => <li key={`${note.source}${note.message}`}>{note.source}: {note.message}</li>)}</ul>
            </div>
          ) : null}
          {rec.differences.length || rec.weightDifferences.length ? (
            <details className="rounded-lg border border-(--surface-border) p-3">
              <summary className="cursor-pointer font-medium">Differences ({rec.differences.length + rec.weightDifferences.length})</summary>
              <table className="mt-2 w-full text-left text-xs tabular-nums">
                <thead className="text-muted-foreground"><tr><th className="py-1 font-medium">Day</th><th className="font-medium">Value</th><th className="font-medium">Sheet</th><th className="font-medium">Bodyshop</th></tr></thead>
                <tbody>
                  {[...rec.differences, ...rec.weightDifferences].slice(0, 100).map((one) => (
                    <tr key={`${one.day}${one.field}`} className="border-t border-(--surface-border)"><td className="py-1">{one.day}</td><td>{one.field}</td><td>{typeof one.sheet === "number" ? fmt(one.sheet, 2) : one.sheet ?? "–"}</td><td>{typeof one.bodyshop === "number" ? fmt(one.bodyshop, 2) : one.bodyshop ?? "–"}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
          {preview.warnings.length ? (
            <details className="rounded-lg border border-(--surface-border) p-3">
              <summary className="cursor-pointer font-medium">Notes ({preview.warnings.length})</summary>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">{preview.warnings.map((note) => <li key={`${note.source}${note.message}`}>{note.source}: {note.message}</li>)}</ul>
            </details>
          ) : null}
          {preview.overlap.entries || preview.overlap.weights ? (
            <p className="text-muted-foreground">You logged {preview.overlap.entries} foods and {preview.overlap.weights} weights in Bodyshop on days the workbook also covers. They stay, so check those days for doubles after the import.</p>
          ) : null}
          {preview.replacedChanges ? (
            <p role="alert" style={{ color: "var(--bs-flag)" }}>You corrected or removed {preview.replacedChanges} imported {preview.replacedChanges === 1 ? "record" : "records"} in Bodyshop. This import replaces them with the workbook's rows, so make the same changes in the sheet first.</p>
          ) : null}
          {preview.previous ? <p className="text-muted-foreground">This replaces the import of {preview.previous.fileName} from {new Date(preview.previous.importedAt).toLocaleString("en-GB")}.</p> : null}
          <div><Button onClick={() => void commit()} disabled={busy || preview.errors.length > 0}>Import {fmt(Object.values(preview.records).reduce((sum, count) => sum + count, 0))} records</Button></div>
        </div>
      ) : null}
      {data.imports.length ? (
        <div className="border-t border-(--surface-border) pt-3 text-sm">
          <p className="font-medium">Earlier imports</p>
          <ul className="mt-1 grid gap-1 text-muted-foreground">
            {data.imports.map((one) => <li key={one.id}>{new Date(one.importedAt).toLocaleString("en-GB")}: {one.fileName}, {one.records.entry} foods, {one.matchingDays} of {one.days} days matched</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
