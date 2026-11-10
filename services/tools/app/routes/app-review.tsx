import { useState } from "react";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { authClient } from "../../platform/auth/auth-client.js";
import { signInFlow } from "../../platform/auth/sign-in-flow.js";
import { Button } from "../../platform/ui/components/ui/button.js";

export const Route = createFileRoute("/app-review")({
  validateSearch: (search: Record<string, unknown>) => search,
  head: () => ({
    meta: [
      { title: "App Review sign-in · Pantrino" },
      { name: "robots", content: "noindex, nofollow, noarchive" }
    ]
  }),
  component: ReviewSignInRoute
});

function ReviewSignInRoute() {
  const searchStr = useLocation({ select: (location) => location.searchStr });
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function signIn(username: string, password: string) {
    setSubmitting(true);
    setError(undefined);
    try {
      const flow = signInFlow(searchStr || "?returnTo=%2Fkitchen");
      const result = await authClient.signIn.email({ email: username, password, callbackURL: flow.callbackURL });
      if (result.error) {
        setError("Sign-in failed. Check your username and password, or contact the app owner.");
        setSubmitting(false);
      } else {
        window.location.assign(result.data?.url ?? flow.callbackURL);
      }
    } catch {
      setError("Sign-in is unavailable. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <main id="main" className="grid min-h-svh place-items-center px-4 py-12">
      <ReviewSignInPanel submitting={submitting} error={error} onSignIn={(username, password) => void signIn(username, password)} />
    </main>
  );
}

export function ReviewSignInPanel({ submitting = false, error, onSignIn }: {
  submitting?: boolean;
  error?: string;
  onSignIn: (username: string, password: string) => void;
}) {
  return (
    <section className="grid w-full max-w-[22.5rem] gap-3.5 rounded-2xl border bg-card px-6 py-7" aria-labelledby="review-title">
      <h1 id="review-title" className="text-xl font-semibold">App Review sign-in</h1>
      <p className="text-sm text-muted-foreground">Use the review credentials supplied by the app owner.</p>
      <form className="grid gap-3" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSignIn(String(data.get("username") ?? ""), String(data.get("password") ?? ""));
      }}>
        <label className="grid gap-1 text-sm">Username
          <input className="h-10 rounded-md border bg-background px-3" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={submitting} />
        </label>
        <label className="grid gap-1 text-sm">Password
          <input className="h-10 rounded-md border bg-background px-3" name="password" type="password" autoComplete="current-password" required disabled={submitting} />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</Button>
      </form>
    </section>
  );
}
