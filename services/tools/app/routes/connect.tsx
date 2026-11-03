import { createFileRoute } from "@tanstack/react-router";
import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import { CheckIcon, CopyIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { principalSeesProduct } from "../../platform/access/product-access.js";
import { requireSignedInSession } from "../../platform/auth/middleware.js";
import { requireSignedIn } from "../../platform/auth/session.js";
import { AppShell } from "../../platform/ui/components/app-shell.js";
import { PageHeader } from "../../platform/ui/components/page-header.js";
import { Button } from "../../platform/ui/components/ui/button.js";

/** The MCP address and what the signed-in person's AI app can use there. */
const getMcpConnection = createServerFn({ method: "GET" })
  .middleware([requireSignedInSession])
  .handler(async ({ context }) => {
    const { MCP_PATH } = await import("../../platform/access/mcp.js");
    const runtime = getGlobalStartContext()?.runtime;
    if (!runtime) throw new Error("The Tools runtime is unavailable.");
    return { url: `${runtime.publicOrigin}${MCP_PATH}`, email: context.principal.email, kitchen: principalSeesProduct(context.principal, "kitchen") };
  });

export const Route = createFileRoute("/connect")({
  beforeLoad: async ({ location }) => ({ principal: await requireSignedIn(location.href) }),
  loader: () => getMcpConnection(),
  head: () => ({ meta: [{ title: "Connect an AI app — Mauroner Tools" }] }),
  component: ConnectPage
});

type App = { name: string; steps: (url: string) => ReactNode };

const APPS: readonly App[] = [
  {
    name: "Claude (web, desktop, and phone)",
    steps: (url) => (
      <>
        <ol>
          <li>In Claude, open Settings, then Connectors.</li>
          <li>Select <b>Add custom connector</b>.</li>
          <li>Enter the name <b>Tools</b> and paste the server address. Select <b>Add</b>.</li>
          <li>Select <b>Connect</b>. Sign in with Google and select <b>Allow</b>.</li>
        </ol>
        <CopyField label="Server address" value={url} />
        <p>On the phone, add the connector on claude.ai first. The app then shows it too.</p>
      </>
    )
  },
  {
    name: "Claude Code",
    steps: (url) => (
      <ol>
        <li>Run this command in a terminal:<CopyField label="Command" value={`claude mcp add --transport http tools ${url}`} /></li>
        <li>In Claude Code, type <code>/mcp</code>, select <b>tools</b>, and select <b>Authenticate</b>. Sign in with Google and select <b>Allow</b>.</li>
      </ol>
    )
  },
  {
    name: "ChatGPT",
    steps: (url) => (
      <>
        <ol>
          <li>Open Settings, then Apps and connectors. Under Advanced settings, turn on Developer mode.</li>
          <li>Select <b>Create</b>, enter the name <b>Tools</b>, and paste the server address.</li>
          <li>For authentication, select <b>OAuth</b>. Sign in with Google and select <b>Allow</b>.</li>
        </ol>
        <CopyField label="Server address" value={url} />
        <p>Developer mode is available only on some ChatGPT plans.</p>
      </>
    )
  },
  {
    name: "Codex",
    steps: (url) => (
      <ol>
        <li>Add the server:<CopyField label="Command" value={`codex mcp add tools --url ${url}`} /></li>
        <li>Sign in. A browser window opens. Sign in with Google and select <b>Allow</b>.<CopyField label="Command" value="codex mcp login tools" /></li>
      </ol>
    )
  },
  {
    name: "Other apps, such as Cursor or VS Code",
    steps: (url) => (
      <>
        <p>Add the address as a remote MCP server that uses HTTP. Sign-in uses OAuth with automatic client registration, so you do not need a client ID or an API key.</p>
        <CopyField label="Settings file" value={JSON.stringify({ mcpServers: { tools: { url } } }, null, 2)} />
        <p>VS Code uses <code>servers</code> and <code>"type": "http"</code> in place of <code>mcpServers</code>.</p>
      </>
    )
  }
];

const EXAMPLES = [
  "What can I cook tonight with what is at home?",
  "Plan three dinners for next week and put what is missing on the shopping list.",
  "I bought 1 kg of rice and 6 eggs. Add them to what is at home."
];

function ConnectPage() {
  const { url, email, kitchen } = Route.useLoaderData();
  return (
    <>
      <AppShell product="Connect an AI app" />
      <main id="main" className="tools-page">
        <PageHeader title="Connect an AI app" facts="Use Tools from Claude, ChatGPT, Codex, or another app that supports MCP" />
        <div className="grid max-w-3xl gap-6">
          <Card title="Server address">
            <CopyField label="Server address" value={url} />
            <p>
              Your app opens a Google sign-in and asks you to allow access. After that, it acts as <b className="break-all">{email}</b>.
              {kitchen ? " It can read and change your Kitchen: recipes, ingredients, the week plan, the shopping list, and what is at home." : " No tool that you can open has AI access yet. The app can only show which account it uses."}
            </p>
          </Card>
          <Card title="Set up your app">
            <div className="grid gap-2">
              {APPS.map((app, index) => (
                <details key={app.name} open={index === 0} className="group rounded-lg ring-1 ring-[color:var(--surface-border)] open:bg-muted/30">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 text-sm font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                    {app.name}
                    <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
                  </summary>
                  <div className="grid gap-3 px-3 pb-3 text-sm [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5">{app.steps(url)}</div>
                </details>
              ))}
            </div>
          </Card>
          {kitchen ? (
            <Card title="Things to ask">
              <ul className="grid gap-1.5">
                {EXAMPLES.map((example) => <li key={example} className="rounded-lg bg-muted/50 px-3 py-2">{example}</li>)}
              </ul>
            </Card>
          ) : null}
          <Card title="If it does not connect">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Sign in to Tools in the same browser first, then try again.</li>
              <li>If the app says that the token is not valid, remove the connector and add it again.</li>
              <li>Ask the app to use the <b>Who am I</b> tool. It shows the account that the app uses.</li>
            </ul>
          </Card>
        </div>
      </main>
    </>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-xl bg-card p-4 text-sm ring-1 ring-[color:var(--surface-border)] sm:p-5" aria-label={title}>
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** A value to paste somewhere else, with a button that copies it. */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true); setFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="mt-1.5 grid gap-1">
      <div className="flex items-start gap-2 rounded-lg bg-muted/60 py-1 pr-1 pl-3">
        <pre aria-label={label} className="min-w-0 flex-1 overflow-x-auto py-1.5 font-mono text-[0.8125rem] leading-5 whitespace-pre-wrap break-all">{value}</pre>
        <Button size="icon-sm" variant="ghost" className="size-9 shrink-0" aria-label={copied ? "Copied" : `Copy ${label.toLowerCase()}`} onClick={() => void copy()}>
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      {failed ? <p role="alert" className="text-xs text-destructive">Could not copy. Select the text and copy it yourself.</p> : null}
    </div>
  );
}
