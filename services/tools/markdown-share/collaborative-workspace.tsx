import { EditorContent } from "@tiptap/react";
import type { Content, AnyExtension } from "@tiptap/core";
import { documentRequest } from "./transport.js";
import { rememberRecentDocument } from "./recent-documents.js";
import { documentSyncExtension } from "./sync-extension.js";
import type { PublicDocument, DocumentSnapshot, PresenceEntry, SyncUpdate, CheckpointSummary } from "./types.js";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { favicons } from "../src/favicons.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  formatExpiry,
  formatViewerCount,
  getPresenceIdentity,
  markdownSourceLines,
} from "./lib";
import {
  applyThemeChoice,
  loadThemeChoice,
  storeThemeChoice,
  THEME_CHOICES,
  type ThemeChoice,
} from "./theme";
import {
  useLiveDocumentEditor,
  useSyncFailure,
  type SyncFailure,
} from "./live-document-session";
import { remarkPreserveExtraBlankLines } from "./markdown";
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

export function CollaborativeWorkspace({ snapshot }: { snapshot: DocumentSnapshot }) {
  const identity = useMemo(getPresenceIdentity, []);
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const [document, setDocument] = useState(snapshot.document);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const { failure: syncFailure, onSyncError, onSyncRecovered } = useSyncFailure();
  useEffect(() => {
    rememberRecentDocument({ token: document.token, filename: document.filename, expiresAt: document.expiresAt, lastOpenedAt: Date.now() });
  }, [document.token, document.filename, document.expiresAt]);
  const syncExtension = useMemo(() => documentSyncExtension({
    token: snapshot.document.token,
    version: snapshot.version,
    onError: onSyncError,
    onRecovered: onSyncRecovered,
    onUpdate(update: SyncUpdate) {
      setDocument(update.document);
      setPresence(update.presence);
      setCheckpoints(update.checkpoints);
    },
  }), [snapshot, onSyncError, onSyncRecovered]);
  useEffect(() => {
    const abort = new AbortController();
    const body = { sessionId, userId: identity.userId, name: identity.displayName };
    const heartbeat = () => void documentRequest(document.token, "/presence", body, abort.signal).catch(() => {});
    const leave = () => {
      navigator.sendBeacon?.(`/api/share/documents/${encodeURIComponent(document.token)}/leave`,
        new Blob([JSON.stringify({ sessionId })], { type: "application/json" }));
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    const visibility = () => {
      clearInterval(timer);
      if (!window.document.hidden) {
        heartbeat();
        timer = setInterval(heartbeat, 15_000);
      }
    };
    visibility();
    window.document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      abort.abort();
      window.document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [document.token, identity, sessionId]);
  return <EditorWorkspace document={document} anonymousName={identity.displayName}
    presence={presence} checkpoints={checkpoints} onCheckpoint={(checkpoint) => setCheckpoints((current) => [checkpoint, ...current.filter((entry) => entry._id !== checkpoint._id)])}
    onDocument={setDocument} syncExtension={syncExtension} initialContent={snapshot.content}
    syncFailure={syncFailure} onSyncRecovered={onSyncRecovered} />;
}

function EditorWorkspace({
  document,
  anonymousName,
  presence,
  checkpoints,
  onCheckpoint,
  onDocument,
  syncExtension,
  initialContent,
  syncFailure,
  onSyncRecovered,
}: {
  document: PublicDocument;
  anonymousName: string;
  presence: PresenceEntry[];
  syncExtension: AnyExtension;
  checkpoints: CheckpointSummary[];
  onCheckpoint: (checkpoint: CheckpointSummary) => void;
  onDocument: (document: PublicDocument) => void;
  initialContent: Content;
  syncFailure: SyncFailure | null;
  onSyncRecovered: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const [topbarMenuOpen, setTopbarMenuOpen] = useState(false);

  const [themeChoice, setThemeChoice] =
    useState<ThemeChoice>(loadThemeChoice);
  const [displaySettings, setDisplaySettings] =
    useState<DisplaySettings>(loadDisplaySettings);
  const topbarMenuRef = useRef<HTMLDivElement>(null);
  const session = useLiveDocumentEditor({
    initialContent,
    syncExtension,
    syncFailure,
    onSyncRecovered,
  });
  const viewport = useWorkspaceViewport();
  const history = useDocumentHistory({
    token: document.token,
    createdBy: anonymousName,
    canCreateCheckpoint: session.canCreateCheckpoint && session.saveStatus === "saved",
    checkpoints,
    onCheckpoint,
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
    storeThemeChoice(themeChoice);
    applyThemeChoice(themeChoice);
  }, [themeChoice]);

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
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  const downloadSource = () => {
    const url = URL.createObjectURL(new Blob([session.markdown], { type: "text/plain;charset=utf-8" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = document.filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportDocument = () => {
    if (document.format === "latex") downloadSource();
    else void printDocument();
  };

  const printDocument = async () => {
    await window.document.fonts.ready;
    window.print();
  };

  const togglePin = async () => {
    setPinBusy(true);
    setActionError(null);
    try {
      onDocument(await documentRequest<PublicDocument>(document.token, "/pin", { pinned: !document.pinned }));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not change the pin.");
    } finally {
      setPinBusy(false);
    }
  };

  return (
    <main
      className={`editor-shell${viewport.isPreviewOnly ? " preview-only" : ""}${syncFailure ? " has-sync-error" : ""}`}
      style={
        {
          "--markdown-share-preview-font-scale": displaySettings.fontScale,
          "--markdown-share-preview-line-height": displaySettings.lineSpacing,
        } as React.CSSProperties
      }
    >
      <header className="topbar">
        <div className="topbar-identity">
          <a className="tools-return tools-return-compact" href="/" aria-label="Back to Tools dashboard"><span aria-hidden="true">←</span><span className="tools-return-label">Tools</span></a>
          <a className="wordmark" href="/share" aria-label="Document Share home">
            <img className="wordmark-icon" src={favicons.markdownShare} alt="" />
            <span className="wordmark-name">Document Share</span>
          </a>
          <div className="document-identity">
            <strong title={document.filename}>{document.filename}</strong>
            {document.pinned ? (
              <span className="pin-badge" title="Pinned for 30 days">
                Pinned
              </span>
            ) : null}
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
            onClick={exportDocument}
          >
            {document.format === "latex" ? "Download .tex" : "Export PDF"}
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
                <button type="button" onClick={exportDocument}>
                  {document.format === "latex" ? "Download .tex" : "Export PDF"}
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
                <button
                  type="button"
                  disabled={pinBusy}
                  onClick={() => void togglePin()}
                >
                  {document.pinned
                    ? "Unpin (back to 7-day expiry)"
                    : "Pin for 30 days"}
                </button>
                <div className="theme-control">
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

      {actionError ? <p className="sync-error-banner" role="alert">{actionError}</p> : null}
      {session.inputError ? <p className="sync-error-banner" role="alert">{session.inputError}</p> : null}
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
              {document.format === "latex" ? "LaTeX" : "Markdown"}
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
          <span className="pane-label" aria-hidden="true">{document.format === "latex" ? "LaTeX" : "Markdown"}</span>
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
            {document.format === "latex" ? (
              <section aria-label="LaTeX preview status">
                <h2>LaTeX source document</h2>
                <p>PDF compilation is not available yet. Edit together and download the .tex source.</p>
              </section>
            ) : <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkPreserveExtraBlankLines]}
            >
              {session.markdown}
            </ReactMarkdown>}
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
