import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { requireSignedIn } from "../../platform/auth/session.js";
import { favicons } from "../../platform/ui/favicons.js";
import { Button } from "../../platform/ui/components/ui/button.js";
import { authClient } from "../../platform/auth/auth-client.js";

type ConsentSearch = { client_id?: string; scope?: string; redirect_uri?: string };

const SCOPE_TEXT: Readonly<Record<string, string>> = {
  openid: "Confirm that you are signed in",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected without asking you again"
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The client name is chosen by whoever registered it, so the person also sees where the access goes. */
export function consentDestination(redirectUri: string | undefined) {
  if (!redirectUri) return undefined;
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== "http:" && url.protocol !== "https:") return `the app ${url.protocol.slice(0, -1)}`;
    return LOOPBACK_HOSTS.has(url.hostname) ? "an app on this computer" : url.host;
  } catch {
    return undefined;
  }
}

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

  const scopes = [...new Set((search.scope ?? "").split(" ").filter(Boolean))];
  const app = clientName ?? "This app";
  const goesTo = consentDestination(search.redirect_uri);

  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-background px-4 py-8">
      <section className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-sm ring-1 ring-[color:var(--surface-border)] sm:p-7" aria-labelledby="consent-title">
        <img className="mb-5 size-11 rounded-xl" src={favicons.directory} alt="" width={44} height={44} />
        <h1 id="consent-title" className="text-xl font-semibold leading-tight text-balance">{app} wants to use your Tools account</h1>
        <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-sm">
          <span className="block text-muted-foreground">It acts as</span>
          <strong className="block truncate font-semibold" title={principal.email}>{principal.email}</strong>
        </p>
        {goesTo ? (
          <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-sm">
            <span className="block text-muted-foreground">Access goes to</span>
            <strong className="block break-all font-semibold">{goesTo}</strong>
          </p>
        ) : null}
        <p className="mt-3 text-sm text-muted-foreground">It can use only the tools and data that this account can open. Allow only if you started this connection.</p>
        {scopes.length ? (
          <ul className="mt-4 grid gap-2 text-sm" aria-label="Requested access">
            {scopes.map((scope) => (
              <li key={scope} className="flex items-start gap-2"><CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{SCOPE_TEXT[scope] ?? scope}</li>
            ))}
          </ul>
        ) : null}
        {error ? <p role="alert" className="mt-4 text-sm text-negative">{error}</p> : null}
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" disabled={busy} onClick={() => void decide(false)}>Deny</Button>
          <Button size="lg" disabled={busy} onClick={() => void decide(true)}>Allow</Button>
        </div>
      </section>
    </main>
  );
}
