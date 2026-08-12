import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../convex/_generated/api";
import { CollaborativeWorkspace } from "./collaborative-workspace";
import {
  documentPath,
  formatExpiry,
  initialMarkdown,
  normalizeFilename,
  parseDocumentRoute,
} from "./lib";
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
  const createDocument = useMutation(api.documents.create);
  const [name, setName] = useState("notes.md");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentDocuments, setRecentDocuments] =
    useState<RecentDocument[]>(readRecentDocuments);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const filename = normalizeFilename(name);
    setIsCreating(true);
    setError(null);

    try {
      const created = await createDocument({
        filename,
        markdown: initialMarkdown(filename),
      });
      rememberRecentDocument({
        token: created.token,
        filename: created.filename,
        expiresAt: created.expiresAt,
        lastOpenedAt: Date.now(),
      });
      window.location.assign(documentPath(created.filename, created.token));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Creation failed.");
      setIsCreating(false);
    }
  };

  return (
    <main className="landing-shell">
      <section className="landing-card">
        <img className="brand-mark" src="/favicon.png" alt="" />
        <p className="eyebrow">A temporary shared page</p>
        <h1>
          Write Markdown.<br />Share one quiet link.
        </h1>
        <p className="landing-copy">
          Edit together in real time, preview as you type, and export a clean
          PDF. No account. Links stay private to this browser. Gone seven days
          after the last edit.
        </p>

        <form className="create-form" onSubmit={handleCreate}>
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
            We’ll make the name URL-safe and add .md.
          </p>
          {error ? <p className="form-error">{error}</p> : null}
        </form>

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
                  <a href={documentPath(document.filename, document.token)}>
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
          <span>Convex realtime</span>
          <span>7-day retention</span>
          <span>PDF export</span>
        </div>
      </section>
    </main>
  );
}

function DocumentPage({ routeToken }: { routeToken: string }) {
  const document = useQuery(api.documents.get, { token: routeToken });

  useEffect(() => {
    if (document === null) {
      forgetRecentDocument(routeToken);
    }
  }, [document, routeToken]);

  useEffect(() => {
    if (!document) {
      return;
    }
    const canonicalPath = documentPath(document.filename, document.token);
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

  return <CollaborativeWorkspace document={document} />;
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
        <img className="status-glyph" src="/favicon.png" alt="" />
        <h1>{label}</h1>
        {detail ? <p>{detail}</p> : null}
        <a href="/">Create a new document</a>
      </div>
    </main>
  );
}
