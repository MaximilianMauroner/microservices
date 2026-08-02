import usePresence from "@convex-dev/presence/react";
import { useTiptapSync } from "@convex-dev/prosemirror-sync/tiptap";
import { EditorContent } from "@tiptap/react";
import type { Content } from "@tiptap/core";
import { useMutation, useQuery } from "convex/react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../convex/_generated/api";
import { useDocumentHistory } from "./document-history";
import {
  DEFAULT_DISPLAY_SETTINGS,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  LINE_SPACING_MAX,
  LINE_SPACING_MIN,
  LINE_SPACING_STEP,
  parseDisplaySettings,
  type DisplaySettings,
} from "./display-settings";
import {
  documentPath,
  formatExpiry,
  formatViewerCount,
  getPresenceIdentity,
  initialMarkdown,
  markdownSourceLines,
  normalizeFilename,
  parseDocumentRoute,
} from "./lib";
import {
  useLiveDocumentEditor,
  useSyncFailure,
  type SyncFailure,
} from "./live-document-session";
import { remarkPreserveExtraBlankLines } from "./markdown";
import {
  forgetRecentDocument,
  readRecentDocuments,
  rememberRecentDocument,
  type RecentDocument,
} from "./recent-documents";
import { useWorkspaceViewport } from "./workspace-viewport";

const DISPLAY_SETTINGS_STORAGE_KEY = "markdown-share:display-settings";

function loadDisplaySettings(): DisplaySettings {
  try {
    return parseDisplaySettings(
      window.localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_DISPLAY_SETTINGS;
  }
}

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
        <div className="brand-mark" aria-hidden="true">
          M↓
        </div>
        <p className="eyebrow">A temporary shared page</p>
        <h1>Write Markdown.<br />Share one quiet link.</h1>
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

        <section className="recent-documents" aria-labelledby="recent-documents-title">
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

  return <LiveDocument document={document} />;
}

type PublicDocument = {
  token: string;
  filename: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

function LiveDocument({ document }: { document: PublicDocument }) {
  const identity = useMemo(getPresenceIdentity, []);
  const { failure: syncFailure, onSyncError } = useSyncFailure();
  const setDisplayName = useMutation(api.presence.setDisplayName);
  const presence = usePresence(
    api.presence,
    document.token,
    identity.userId,
  );
  const sync = useTiptapSync(api.editor, document.token, {
    snapshotDebounceMs: 800,
    onSyncError,
  });

  useEffect(() => {
    const canonicalPath = documentPath(document.filename, document.token);
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState(null, "", canonicalPath);
    }
    documentTitle(document.filename);
    rememberRecentDocument({
      token: document.token,
      filename: document.filename,
      expiresAt: document.expiresAt,
      lastOpenedAt: Date.now(),
    });
  }, [document.expiresAt, document.filename, document.token]);

  useEffect(() => {
    const self = presence?.find((entry) => entry.userId === identity.userId);
    if (self && self.name !== identity.displayName) {
      void setDisplayName({
        roomId: document.token,
        userId: identity.userId,
        name: identity.displayName,
      });
    }
  }, [
    document.token,
    identity.displayName,
    identity.userId,
    presence,
    setDisplayName,
  ]);

  if (sync.isLoading) {
    return <CenteredStatus label="Loading editor history…" />;
  }
  if (sync.initialContent === null || sync.extension === null) {
    return (
      <CenteredStatus
        label="This document has no editor data."
        detail="For safety, opening a link never creates data implicitly."
      />
    );
  }

  return (
    <EditorWorkspace
      document={document}
      anonymousName={identity.displayName}
      presence={presence ?? []}
      syncExtension={sync.extension}
      initialContent={sync.initialContent}
      syncFailure={syncFailure}
    />
  );
}

function documentTitle(filename: string) {
  window.document.title = `${filename} · Markdown Share`;
}

type PresenceEntry = {
  userId: string;
  online: boolean;
  lastDisconnected: number;
  name?: string;
};

type SyncExtension = NonNullable<
  ReturnType<typeof useTiptapSync>["extension"]
>;

function EditorWorkspace({
  document,
  anonymousName,
  presence,
  syncExtension,
  initialContent,
  syncFailure,
}: {
  document: PublicDocument;
  anonymousName: string;
  presence: PresenceEntry[];
  syncExtension: SyncExtension;
  initialContent: Content;
  syncFailure: SyncFailure | null;
}) {
  const [copied, setCopied] = useState(false);
  const [topbarMenuOpen, setTopbarMenuOpen] = useState(false);
  const [displaySettings, setDisplaySettings] =
    useState<DisplaySettings>(loadDisplaySettings);
  const topbarMenuRef = useRef<HTMLDivElement>(null);
  const session = useLiveDocumentEditor({
    initialContent,
    syncExtension,
    syncFailure,
  });
  const viewport = useWorkspaceViewport();
  const history = useDocumentHistory({
    token: document.token,
    createdBy: anonymousName,
    canCreateCheckpoint: session.canCreateCheckpoint,
  });
  const online = presence.filter((entry) => entry.online);
  const viewerCount = Math.max(1, online.length);
  const sourceLines = useMemo(
    () => markdownSourceLines(session.markdown),
    [session.markdown],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        DISPLAY_SETTINGS_STORAGE_KEY,
        JSON.stringify(displaySettings),
      );
    } catch {
      // The settings remain active for this session when storage is unavailable.
    }
  }, [displaySettings]);

  useEffect(() => {
    if (!topbarMenuOpen) {
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!topbarMenuRef.current?.contains(target)) {
        setTopbarMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      setTopbarMenuOpen(false);
      topbarMenuRef.current
        ?.querySelector<HTMLButtonElement>(".overflow-trigger")
        ?.focus();
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [topbarMenuOpen]);

  useEffect(() => {
    if (!topbarMenuOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      topbarMenuRef.current
        ?.querySelector<HTMLButtonElement>(".action-menu button:not(:disabled)")
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [topbarMenuOpen]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const printDocument = async () => {
    await window.document.fonts.ready;
    window.print();
  };

  return (
    <main
      className={`editor-shell${viewport.isPreviewOnly ? " preview-only" : ""}${syncFailure ? " has-sync-error" : ""}`}
      style={
        {
          "--preview-font-scale": displaySettings.fontScale,
          "--preview-line-height": displaySettings.lineSpacing,
        } as React.CSSProperties
      }
    >
      <header className="topbar">
        <div className="topbar-identity">
          <a className="wordmark" href="/" aria-label="Markdown Share home">
            <span className="wordmark-icon">M↓</span>
            <span className="wordmark-name">Markdown Share</span>
          </a>
          <div className="document-identity">
            <strong title={document.filename}>{document.filename}</strong>
            <span className="expiry-full">
              expires in {formatExpiry(document.expiresAt)}
            </span>
            <span className="expiry-compact" aria-label={`expires in ${formatExpiry(document.expiresAt)}`}>
              · {formatExpiry(document.expiresAt)}
            </span>
          </div>
        </div>

        <div className="topbar-actions">
          <div
            className={`save-status save-status-${session.saveStatus}`}
            role="status"
            aria-live="polite"
            title={
              session.saveStatus === "error"
                ? syncFailure?.message ?? "The latest changes could not be saved."
                : session.saveLabel
            }
          >
            <span className="save-status-dot" aria-hidden="true" />
            <span className="save-status-label">
              {session.saveLabel}
            </span>
          </div>
          <div
            className="presence-cluster"
            aria-label={formatViewerCount(viewerCount)}
            title={online
              .map((entry) => entry.name ?? "Anonymous collaborator")
              .join(", ")}
          >
            {online.slice(0, 3).map((entry) => (
              <span
                className="presence-avatar"
                key={entry.userId}
                title={entry.name ?? "Anonymous collaborator"}
              >
                {(entry.name ?? "Anonymous").slice(0, 1)}
              </span>
            ))}
            <span className="viewer-dot" aria-hidden="true" />
            <span className="presence-label presence-label-full">
              {formatViewerCount(viewerCount)}
            </span>
            <span className="presence-label presence-label-compact" aria-hidden="true">
              {viewerCount}
            </span>
          </div>
          <button className="button-secondary direct-copy" type="button" onClick={copyLink}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <button
            className="button-primary direct-pdf"
            type="button"
            onClick={() => void printDocument()}
          >
            Export PDF
          </button>
          <div className="topbar-overflow" ref={topbarMenuRef}>
            <button
              className="overflow-trigger"
              type="button"
              aria-label="More document actions"
              aria-haspopup="dialog"
              aria-expanded={topbarMenuOpen}
              aria-controls="document-actions-menu"
              onClick={() => setTopbarMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">•••</span>
            </button>
            {topbarMenuOpen ? (
              <div
                id="document-actions-menu"
                className="action-menu topbar-action-menu"
                role="dialog"
                aria-label="Document options"
              >
                <button type="button" onClick={() => void copyLink()}>
                  {copied ? "Link copied" : "Copy link"}
                </button>
                <button type="button" onClick={() => void printDocument()}>
                  Export PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTopbarMenuOpen(false);
                    viewport.enterPreviewOnly();
                  }}
                >
                  Full screen preview
                </button>
                <div className="display-settings">
                  <p>Display settings</p>
                  <label>
                    <span>
                      Font size
                      <output>{Math.round(displaySettings.fontScale * 100)}%</output>
                    </span>
                    <input
                      type="range"
                      min={FONT_SCALE_MIN}
                      max={FONT_SCALE_MAX}
                      step={FONT_SCALE_STEP}
                      value={displaySettings.fontScale}
                      onChange={(event) => {
                        const fontScale = Number(event.currentTarget.value);
                        setDisplaySettings((current) => ({
                          ...current,
                          fontScale,
                        }));
                      }}
                    />
                  </label>
                  <label>
                    <span>
                      Line spacing
                      <output>{displaySettings.lineSpacing.toFixed(1)}</output>
                    </span>
                    <input
                      type="range"
                      min={LINE_SPACING_MIN}
                      max={LINE_SPACING_MAX}
                      step={LINE_SPACING_STEP}
                      value={displaySettings.lineSpacing}
                      onChange={(event) => {
                        const lineSpacing = Number(event.currentTarget.value);
                        setDisplaySettings((current) => ({
                          ...current,
                          lineSpacing,
                        }));
                      }}
                    />
                  </label>
                  <button
                    className="display-settings-reset"
                    type="button"
                    onClick={() => setDisplaySettings(DEFAULT_DISPLAY_SETTINGS)}
                  >
                    Reset display
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {syncFailure ? (
        <div
          className={`sync-error-banner sync-error-${syncFailure.kind}`}
          role="alert"
        >
          {syncFailure.message}
        </div>
      ) : null}

      <section className="workspace">
        <div className="mobile-workspace-rail">
          <div className="mobile-view-tabs" role="tablist" aria-label="Document view">
            <button
              id="mobile-source-tab"
              className="mobile-view-tab"
              type="button"
              role="tab"
              aria-selected={viewport.mobilePane === "source"}
              aria-controls="source-panel"
              tabIndex={viewport.mobilePane === "source" ? 0 : -1}
              onClick={() => viewport.setMobilePane("source")}
              onKeyDown={viewport.handleMobileTabKeyDown}
            >
              Markdown
            </button>
            <button
              id="mobile-preview-tab"
              className="mobile-view-tab"
              type="button"
              role="tab"
              aria-selected={viewport.mobilePane === "preview"}
              aria-controls="preview-panel"
              tabIndex={viewport.mobilePane === "preview" ? 0 : -1}
              onClick={() => viewport.setMobilePane("preview")}
              onKeyDown={viewport.handleMobileTabKeyDown}
            >
              Preview
            </button>
          </div>
          {history.renderControl("mobile")}
        </div>

        <section
          id="source-panel"
          className={`panel source-panel mobile-${viewport.mobilePane === "source" ? "active" : "inactive"}`}
        >
          <span className="pane-label" aria-hidden="true">Markdown</span>
          {history.renderControl("desktop")}
          <div
            className="editor-scroll"
            ref={viewport.sourceScrollRef}
            onScroll={() => viewport.handlePaneScroll("source")}
          >
            <div className="editor-document">
              <div className="line-number-layout" aria-hidden="true">
                {sourceLines.map((line, index) => (
                  <Fragment key={index}>
                    <span className="line-number">{index + 1}</span>
                    <span className="line-wrap-measure">
                      {line || "\u200b"}
                    </span>
                  </Fragment>
                ))}
              </div>
              <div className="editor-source">
                <EditorContent editor={session.editor} />
              </div>
            </div>
          </div>
        </section>

        <section
          id="preview-panel"
          className={`panel preview-panel mobile-${viewport.mobilePane === "preview" ? "active" : "inactive"}`}
        >
          <span className="pane-label" aria-hidden="true">Preview</span>
          <button
            className="panel-overlay-action preview-overlay-action"
            type="button"
            onClick={viewport.enterPreviewOnly}
          >
            Full screen preview
          </button>
          <article
            id="print-preview"
            className="preview-scroll markdown-body"
            ref={viewport.previewScrollRef}
            onScroll={() => viewport.handlePaneScroll("preview")}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkPreserveExtraBlankLines]}
            >
              {session.markdown}
            </ReactMarkdown>
          </article>
        </section>
      </section>

      {viewport.isPreviewOnly ? (
        <button
          className="preview-mode-exit"
          type="button"
          onClick={viewport.exitPreviewOnly}
          autoFocus
        >
          Exit preview
        </button>
      ) : null}

      {history.dialog}
    </main>
  );
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
        <span className="status-glyph">M↓</span>
        <h1>{label}</h1>
        {detail ? <p>{detail}</p> : null}
        <a href="/">Create a new document</a>
      </div>
    </main>
  );
}
