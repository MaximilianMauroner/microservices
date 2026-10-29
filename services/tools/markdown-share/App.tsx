import { shareRequest, documentRequest } from "./transport.js";
import type { PublicDocument, DocumentSnapshot } from "./types.js";
import { useEffect, useState } from "react";
import { favicons } from "../src/favicons.js";

import { CollaborativeWorkspace } from "./collaborative-workspace";
import {
  documentPath,
  formatExpiry,
  initialSource,
  type DocumentFormat,
  normalizeFilename,
  parseDocumentRoute,
} from "./lib";
import {
  applyThemeChoice,
  loadThemeChoice,
  storeThemeChoice,
  THEME_CHOICES,
  type ThemeChoice,
} from "./theme";
import {
  forgetRecentDocument,
  readRecentDocuments,
  rememberRecentDocument,
  type RecentDocument,
} from "./recent-documents";

export function App() {
  const route = parseDocumentRoute(window.location.pathname);
  return route ? (
    <DocumentPage routeToken={route.token} />
  ) : (
    <LandingPage />
  );
}

function LandingPage() {

  const [name, setName] = useState("notes");
  const [format, setFormat] = useState<DocumentFormat>("markdown");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [themeChoice, setThemeChoice] =
    useState<ThemeChoice>(loadThemeChoice);
  const [recentDocuments, setRecentDocuments] =
    useState<RecentDocument[]>(readRecentDocuments);

  useEffect(() => {
    storeThemeChoice(themeChoice);
    applyThemeChoice(themeChoice);
  }, [themeChoice]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const filename = normalizeFilename(name, format);
    setIsCreating(true);
    setError(null);

    try {
      const created = await shareRequest<PublicDocument>("", { method: "POST", body: JSON.stringify({
        requestId: crypto.randomUUID(),
        filename,
        markdown: initialSource(filename, format),
        format,
      }) });
      rememberRecentDocument({
        token: created.token,
        filename: created.filename,
        expiresAt: created.expiresAt,
        lastOpenedAt: Date.now(),
      });
      window.location.assign(documentPath(created.filename, created.token, "/share"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Creation failed.");
      setIsCreating(false);
    }
  };

  return (
    <main className="landing-shell">
      <section className="landing-card">
        <a className="tools-return" href="/">← Tools dashboard</a>
        <img className="brand-mark" src={favicons.markdownShare} alt="" />
        <p className="eyebrow">A temporary shared page</p>
        <h1>
          Write Markdown or LaTeX.<br />Share one quiet link.
        </h1>
        <p className="landing-copy">
          Edit source together in real time. Markdown includes live preview and PDF export.
          LaTeX source can be shared and downloaded; PDF compilation is not available yet. No account. Anyone with the document link can open it. Unpinned
          documents expire seven days after the last edit; pinned documents last 30 days.
        </p>

        <form className="create-form" onSubmit={handleCreate}>
          <fieldset className="document-format">
            <legend>Document format</legend>
            {(["markdown", "latex"] as const).map((choice) => (
              <label key={choice}>
                <input type="radio" name="format" value={choice} checked={format === choice} onChange={() => setFormat(choice)} />
                {choice === "latex" ? "LaTeX" : "Markdown"}
              </label>
            ))}
          </fieldset>
          <label htmlFor="filename">Document name</label>
          <div className="filename-row">
            <input
              id="filename"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="filename-note"
            />
            <button type="submit" disabled={isCreating}>
              {isCreating ? "Opening…" : "Create link"}
            </button>
          </div>
          <p id="filename-note" className="field-note">
            We’ll make the name URL-safe and add {format === "latex" ? ".tex" : ".md"}.
          </p>
          {error ? <p className="form-error">{error}</p> : null}
        </form>

        <div className="theme-control landing-theme">
          <p>Theme</p>
          <div className="theme-options" role="group" aria-label="Color theme">
            {THEME_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={themeChoice === choice}
                onClick={() => setThemeChoice(choice)}
              >
                {choice.slice(0, 1).toUpperCase() + choice.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <section
          className="recent-documents"
          aria-labelledby="recent-documents-title"
        >
          <div className="recent-documents-heading">
            <h2 id="recent-documents-title">Your document links</h2>
            <span>Saved in this browser</span>
          </div>
          {recentDocuments.length > 0 ? (
            <ul>
              {recentDocuments.map((document) => (
                <li key={document.token}>
                  <a href={documentPath(document.filename, document.token, "/share")}>
                    <strong>{document.filename}</strong>
                    <span>Expires in {formatExpiry(document.expiresAt)}</span>
                  </a>
                  <button
                    type="button"
                    aria-label={`Remove ${document.filename} from this browser`}
                    onClick={() =>
                      setRecentDocuments(forgetRecentDocument(document.token))
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="recent-documents-empty">
              Documents you create or open will appear here.
            </p>
          )}
        </section>

        <div className="promise-row" aria-label="Product features">
          <span>Live collaboration</span>
          <span>7 days · pinned 30 days</span>
          <span>Markdown PDF export</span>
        </div>
      </section>
    </main>
  );
}

function DocumentPage({ routeToken }: { routeToken: string }) {
  const [snapshot, setSnapshot] = useState<DocumentSnapshot | null>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const document = snapshot == null ? snapshot : snapshot.document;
  useEffect(() => {
    const abort = new AbortController();
    void documentRequest<DocumentSnapshot | null>(routeToken, "", undefined, abort.signal)
      .then(setSnapshot).catch((error: Error) => { if (!abort.signal.aborted) setLoadError(error.message); });
    return () => abort.abort();
  }, [routeToken]);

  useEffect(() => {
    if (document === null) {
      forgetRecentDocument(routeToken);
    }
  }, [document, routeToken]);

  useEffect(() => {
    if (!document) {
      return;
    }
    const canonicalPath = documentPath(document.filename, document.token, "/share");
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState(null, "", canonicalPath);
    }
    window.document.title = `${document.filename} · Markdown Share`;
    rememberRecentDocument({
      token: document.token,
      filename: document.filename,
      expiresAt: document.expiresAt,
      lastOpenedAt: Date.now(),
    });
  }, [document?.expiresAt, document?.filename, document?.token]);

  if (loadError) return <CenteredStatus label="Could not open document." detail={loadError} />;
  if (document === undefined) {
    return <CenteredStatus label="Opening shared document…" />;
  }
  if (document === null) {
    return (
      <CenteredStatus
        label="This link is unavailable."
        detail="It may have expired, or it may never have been initialized."
      />
    );
  }

  return <CollaborativeWorkspace key={routeToken} snapshot={snapshot!} />;
}

function CenteredStatus({
  label,
  detail,
}: {
  label: string;
  detail?: string;
}) {
  return (
    <main className="status-shell">
      <div className="status-card">
        <img className="status-glyph" src={favicons.markdownShare} alt="" />
        <h1>{label}</h1>
        {detail ? <p>{detail}</p> : null}
        <a href="/markdown">Create a new document</a>
      </div>
    </main>
  );
}
