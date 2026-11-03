import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { requireSignedIn } from "../auth-session.js";
import { favicons } from "../favicons.js";
import { Button } from "../components/ui/button.js";
import { authClient } from "../lib/auth-client.js";

type ConsentSearch = { client_id?: string; scope?: string };

export const Route = createFileRoute("/consent")({
  validateSearch: (search: Record<string, unknown>): ConsentSearch => search as ConsentSearch,
  beforeLoad: async ({ location }) => ({ principal: await requireSignedIn(location.href) }),
  head: () => ({ meta: [{ title: "Allow access · Mauroner Tools" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: ConsentPage
});

function ConsentPage() {
  const search = Route.useSearch();
  const { principal } = Route.useRouteContext();
  const [clientName, setClientName] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!search.client_id) return;
    void authClient.$fetch<{ client_name?: string }>("/oauth2/public-client", { query: { client_id: search.client_id } })
      .then(({ data }) => setClientName(data?.client_name));
  }, [search.client_id]);

  async function decide(accept: boolean) {
    setBusy(true); setError(undefined);
    const { data, error: failure } = await authClient.$fetch<{ url?: string; redirect_uri?: string }>("/oauth2/consent", { method: "POST", body: { accept } });
    const target = data?.url ?? data?.redirect_uri;
    if (target) { window.location.assign(target); return; }
    setError(failure?.message ?? "The request expired. Start the connection again from your app.");
    setBusy(false);
  }

  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <section className="w-full max-w-sm rounded-xl bg-card p-6 ring-1 ring-[color:var(--surface-border)]" aria-labelledby="consent-title">
        <img className="mb-4 size-10 rounded-lg" src={favicons.directory} alt="" width={40} height={40} />
        <h1 id="consent-title" className="text-lg font-semibold">Allow {clientName ?? "this app"} to use Tools?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It acts as {principal.email} and can use only the tools that this account can open.
        </p>
        {search.scope ? <p className="mt-3 text-xs text-muted-foreground">Requested: {search.scope}</p> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-negative">{error}</p> : null}
        <div className="mt-5 flex gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => void decide(true)}>Allow</Button>
          <Button className="flex-1" variant="outline" disabled={busy} onClick={() => void decide(false)}>Deny</Button>
        </div>
      </section>
    </main>
  );
}
