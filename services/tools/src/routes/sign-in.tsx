import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentPrincipal } from "../auth-session.js";
import { favicons } from "../favicons.js";
import { Button } from "../components/ui/button.js";
import { authClient } from "../lib/auth-client.js";
import { safeReturnPath, type SignInReason } from "../lib/auth-return-path.js";

type SignInSearch = {
  returnTo: string;
  reason?: SignInReason;
  error?: string;
};

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    returnTo: safeReturnPath(search.returnTo),
    ...(search.reason === "session_required" || search.reason === "session_expired"
      ? { reason: search.reason }
      : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {})
  }),
  beforeLoad: async ({ search }) => {
    if (await getCurrentPrincipal()) {
      throw redirect({ href: search.returnTo });
    }
  },
  head: () => ({
    meta: [
      { title: "Sign in · Mauroner Tools" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#000000" }
    ]
  }),
  component: SignInRoute
});

function SignInRoute() {
  const search = Route.useSearch();
  const [submitting, setSubmitting] = useState(false);
  const unauthorized = search.error?.toLowerCase().includes("account_not_allowed") ||
    search.error?.toLowerCase().includes("forbidden") ||
    search.error?.toLowerCase().includes("unable_to_get_user_info");
  const expired = search.reason === "session_expired";

  async function signIn() {
    setSubmitting(true);
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: search.returnTo,
      errorCallbackURL: `/sign-in?returnTo=${encodeURIComponent(search.returnTo)}`
    });
    if (result.error) setSubmitting(false);
  }

  return (
    <main id="main" className="grid min-h-svh place-items-center px-4 py-12">
      <SignInPanel
        state={unauthorized ? "unauthorized" : expired ? "expired" : "sign-in"}
        submitting={submitting}
        onSignIn={() => void signIn()}
      />
    </main>
  );
}

export function SignInPanel({
  state,
  submitting = false,
  onSignIn
}: {
  state: "sign-in" | "unauthorized" | "expired";
  submitting?: boolean;
  onSignIn?: () => void;
}) {
  return (
    <section className="grid w-full max-w-[22.5rem] gap-3.5 rounded-2xl border bg-card px-6 py-7 text-center" aria-labelledby="sign-in-title">
      <img className="mx-auto size-10 rounded-xl" src={favicons.directory} alt="" width={40} height={40} />
      <h1 id="sign-in-title" className="text-xl font-semibold tracking-[-0.01em]">
        {state === "unauthorized" ? "This account has no access" : state === "expired" ? "Session expired" : "Sign in to Tools"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {state === "unauthorized"
          ? "Only one Google account can use this workspace. Choose that account."
          : state === "expired"
            ? "Sign in again to return to your work."
            : "Use the Google account that owns this workspace."}
      </p>
      <Button className="h-10 w-full" type="button" disabled={submitting} onClick={onSignIn}>
        <GoogleMark />
        {submitting ? "Opening Google…" : state === "unauthorized" ? "Use another Google account" : "Continue with Google"}
      </Button>
      <p className="text-xs text-muted-foreground">The session lasts 7 days on this device.</p>
    </section>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.7A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-3.9V7.4H3.1a10 10 0 0 0 0 9.3L6.5 14Z" />
      <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.9 1.5l2.9-2.9A9.7 9.7 0 0 0 3.1 7.4l3.4 2.7A5.9 5.9 0 0 1 12 5.9Z" />
    </svg>
  );
}
