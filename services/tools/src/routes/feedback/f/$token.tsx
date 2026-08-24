import { createFileRoute } from "@tanstack/react-router";
import { PublicFeedbackPage } from "../../../../feedback/public-page.js";
import { submitPublicFeedback } from "../../../../feedback/public-handler.js";
import { getPublicFeedbackForm } from "../../../../feedback/server-functions.js";

type PublicFeedbackSearch = { lang?: "en" | "de"; submitted?: boolean; error?: string };

export const Route = createFileRoute("/feedback/f/$token")({
  validateSearch: (search: Record<string, unknown>): PublicFeedbackSearch => ({ lang: search.lang === "de" ? "de" : "en", submitted: search.submitted === true || search.submitted === "1" ? true : undefined, error: typeof search.error === "string" ? search.error : undefined }),
  loaderDeps: ({ search }) => ({ locale: search.lang ?? "en" }),
  loader: ({ params, deps }) => getPublicFeedbackForm({ data: { token: params.token, locale: deps.locale } }),
  head: () => ({ meta: [{ title: "Private feedback" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: PublicRoute,
  server: { handlers: { POST: submitPublicFeedback } }
});

function PublicRoute() {
  const form = Route.useLoaderData();
  const search = Route.useSearch();
  if (!form) return <main className="mx-auto w-[min(620px,calc(100%_-_2rem))] py-20"><h1 className="text-2xl font-semibold">Feedback form not found</h1><p className="mt-3 text-muted-foreground">This link may have been closed or replaced.</p></main>;
  return <PublicFeedbackPage form={form} submitted={search.submitted === true} error={search.error} />;
}
