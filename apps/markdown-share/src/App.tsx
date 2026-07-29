import usePresence from "@convex-dev/presence/react";
import { useTiptapSync } from "@convex-dev/prosemirror-sync/tiptap";
import CodeBlock from "@tiptap/extension-code-block";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions/undo-redo";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Content } from "@tiptap/core";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  buildDiffRows,
  documentPath,
  formatExpiry,
  formatViewerCount,
  getScrollProgress,
  getScrollTop,
  getPresenceIdentity,
  initialMarkdown,
  markdownFromJson,
  normalizeFilename,
  parseDocumentRoute,
} from "./lib";
import { remarkPreserveExtraBlankLines } from "./markdown";

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
          PDF. No account. No document list. Gone seven days after the last edit.
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
  const setDisplayName = useMutation(api.presence.setDisplayName);
  const presence = usePresence(
    api.presence,
    document.token,
    identity.userId,
  );
  const sync = useTiptapSync(api.editor, document.token, {
    snapshotDebounceMs: 800,
  });

  useEffect(() => {
    const canonicalPath = documentPath(document.filename, document.token);
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState(null, "", canonicalPath);
    }
    documentTitle(document.filename);
  }, [document.filename, document.token]);

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

type CheckpointSummary = {
  _id: Id<"checkpoints">;
  createdAt: number;
  createdBy: string;
  charCount: number;
};

type CheckpointComparison = {
  older: Omit<CheckpointSummary, "charCount"> & { markdown: string };
  newer: Omit<CheckpointSummary, "charCount"> & { markdown: string };
};

type WorkspacePane = "source" | "preview";

function EditorWorkspace({
  document,
  anonymousName,
  presence,
  syncExtension,
  initialContent,
}: {
  document: PublicDocument;
  anonymousName: string;
  presence: PresenceEntry[];
  syncExtension: SyncExtension;
  initialContent: Content;
}) {
  const [markdown, setMarkdown] = useState(() =>
    markdownFromJson(initialContent),
  );
  const [copied, setCopied] = useState(false);
  const [checkpointStatus, setCheckpointStatus] = useState("Save as checkpoint");
  const [isSavingCheckpoint, setIsSavingCheckpoint] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [isPreviewOnly, setIsPreviewOnly] = useState(false);
  const [mobilePane, setMobilePane] = useState<WorkspacePane>("source");
  const [topbarMenuOpen, setTopbarMenuOpen] = useState(false);
  const [historyMenuPlacement, setHistoryMenuPlacement] = useState<
    "desktop" | "mobile" | null
  >(null);
  const [olderId, setOlderId] = useState<Id<"checkpoints"> | null>(null);
  const [newerId, setNewerId] = useState<Id<"checkpoints"> | null>(null);
  const sourceScrollRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLElement>(null);
  const topbarMenuRef = useRef<HTMLDivElement>(null);
  const desktopHistoryRef = useRef<HTMLDivElement>(null);
  const mobileHistoryRef = useRef<HTMLDivElement>(null);
  const comparisonOpenerRef = useRef<HTMLElement | null>(null);
  const scrollProgressRef = useRef(0);
  const pendingScrollPaneRef = useRef<WorkspacePane | null>(null);
  const scrollSyncFrameRef = useRef<number | null>(null);
  const ignoredScrollPaneRef = useRef<WorkspacePane | null>(null);
  const ignoredScrollFrameRef = useRef<number | null>(null);
  const checkpoints = useQuery(api.checkpoints.list, {
    token: document.token,
  });
  const saveCheckpoint = useMutation(api.checkpoints.create);
  const comparison = useQuery(
    api.checkpoints.compare,
    isComparing && olderId && newerId && olderId !== newerId
      ? { token: document.token, olderId, newerId }
      : "skip",
  );
  const online = presence.filter((entry) => entry.online);
  const viewerCount = Math.max(1, online.length);
  const editor = useEditor({
    extensions: [
      Document,
      Text,
      CodeBlock.configure({
        exitOnArrowDown: false,
        exitOnTripleEnter: false,
      }),
      UndoRedo,
      syncExtension,
    ],
    content: initialContent,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        "aria-label": "Markdown source",
        autocapitalize: "off",
        autocomplete: "off",
        spellcheck: "false",
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      setMarkdown(
        updatedEditor.state.doc.textBetween(
          0,
          updatedEditor.state.doc.content.size,
          "\n",
        ),
      );
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    const updatePreview = () => {
      setMarkdown(
        editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n"),
      );
    };
    editor.on("transaction", updatePreview);
    return () => {
      editor.off("transaction", updatePreview);
    };
  }, [editor]);

  useEffect(() => {
    if (!checkpoints || checkpoints.length < 2) {
      return;
    }
    const availableIds = new Set(checkpoints.map((checkpoint) => checkpoint._id));
    if (!newerId || !availableIds.has(newerId)) {
      setNewerId(checkpoints[0]?._id ?? null);
    }
    if (!olderId || !availableIds.has(olderId)) {
      setOlderId(checkpoints[1]?._id ?? null);
    }
  }, [checkpoints, newerId, olderId]);

  useEffect(() => {
    if (!isPreviewOnly) {
      return;
    }
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPreviewOnly(false);
      }
    };
    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [isPreviewOnly]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const element =
        isPreviewOnly
          ? previewScrollRef.current
          : mobilePane === "source"
          ? sourceScrollRef.current
          : previewScrollRef.current;
      if (!element || element.clientHeight === 0) {
        return;
      }
      element.scrollTop = getScrollTop(
        scrollProgressRef.current,
        element.scrollHeight,
        element.clientHeight,
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isPreviewOnly, mobilePane]);

  useEffect(() => {
    let frame: number | null = null;
    const viewport = window.visualViewport;
    let previousWindowWidth = window.innerWidth;
    let previousViewportWidth = viewport?.width ?? window.innerWidth;

    const syncAppHeight = () => {
      window.document.documentElement.style.setProperty(
        "--app-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
    };
    const editableTargetIsFocused = () => {
      const activeElement = window.document.activeElement;
      return (
        activeElement instanceof HTMLElement &&
        (activeElement.isContentEditable ||
          activeElement.matches("input, textarea, select"))
      );
    };
    const restoreProportionalScroll = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        for (const element of [
          sourceScrollRef.current,
          previewScrollRef.current,
        ]) {
          if (element && element.clientHeight > 0) {
            element.scrollTop = getScrollTop(
              scrollProgressRef.current,
              element.scrollHeight,
              element.clientHeight,
            );
          }
        }
      });
    };
    const handleWindowResize = () => {
      const widthChanged = window.innerWidth !== previousWindowWidth;
      previousWindowWidth = window.innerWidth;
      syncAppHeight();
      if (widthChanged || !editableTargetIsFocused()) {
        restoreProportionalScroll();
      }
    };
    const handleViewportResize = () => {
      const width = viewport?.width ?? window.innerWidth;
      const widthChanged = width !== previousViewportWidth;
      previousViewportWidth = width;
      syncAppHeight();
      if (widthChanged || !editableTargetIsFocused()) {
        restoreProportionalScroll();
      }
    };

    syncAppHeight();
    window.addEventListener("resize", handleWindowResize);
    viewport?.addEventListener("resize", handleViewportResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      viewport?.removeEventListener("resize", handleViewportResize);
      window.document.documentElement.style.removeProperty("--app-height");
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  useEffect(() => {
    if (!topbarMenuOpen && historyMenuPlacement === null) {
      return;
    }
    const historyRef =
      historyMenuPlacement === "desktop"
        ? desktopHistoryRef
        : mobileHistoryRef;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (topbarMenuOpen && !topbarMenuRef.current?.contains(target)) {
        setTopbarMenuOpen(false);
      }
      if (
        historyMenuPlacement !== null &&
        !historyRef.current?.contains(target)
      ) {
        setHistoryMenuPlacement(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (topbarMenuOpen) {
        setTopbarMenuOpen(false);
        topbarMenuRef.current?.querySelector<HTMLButtonElement>(
          ".overflow-trigger",
        )?.focus();
      }
      if (historyMenuPlacement !== null) {
        setHistoryMenuPlacement(null);
        historyRef.current?.querySelector<HTMLButtonElement>(
          ".history-trigger",
        )?.focus();
      }
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [historyMenuPlacement, topbarMenuOpen]);

  useEffect(() => {
    if (!topbarMenuOpen && historyMenuPlacement === null) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const container = topbarMenuOpen
        ? topbarMenuRef.current
        : historyMenuPlacement === "desktop"
          ? desktopHistoryRef.current
          : mobileHistoryRef.current;
      container
        ?.querySelector<HTMLButtonElement>('[role="menu"] button:not(:disabled)')
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [historyMenuPlacement, topbarMenuOpen]);

  useEffect(
    () => () => {
      if (scrollSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollSyncFrameRef.current);
      }
      if (ignoredScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(ignoredScrollFrameRef.current);
      }
    },
    [],
  );

  const handlePaneScroll = (pane: WorkspacePane) => {
    if (ignoredScrollPaneRef.current === pane) {
      return;
    }

    pendingScrollPaneRef.current = pane;
    if (scrollSyncFrameRef.current !== null) {
      return;
    }

    scrollSyncFrameRef.current = window.requestAnimationFrame(() => {
      scrollSyncFrameRef.current = null;
      const activePane = pendingScrollPaneRef.current;
      pendingScrollPaneRef.current = null;
      if (!activePane) {
        return;
      }

      const source =
        activePane === "source"
          ? sourceScrollRef.current
          : previewScrollRef.current;
      const targetPane: WorkspacePane =
        activePane === "source" ? "preview" : "source";
      const target =
        targetPane === "source"
          ? sourceScrollRef.current
          : previewScrollRef.current;
      if (!source) {
        return;
      }

      const progress = getScrollProgress(
        source.scrollTop,
        source.scrollHeight,
        source.clientHeight,
      );
      scrollProgressRef.current = progress;

      if (!target || target.clientHeight === 0) {
        return;
      }

      const nextScrollTop = getScrollTop(
        progress,
        target.scrollHeight,
        target.clientHeight,
      );
      if (Math.abs(target.scrollTop - nextScrollTop) < 1) {
        return;
      }

      ignoredScrollPaneRef.current = targetPane;
      target.scrollTop = nextScrollTop;
      if (ignoredScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(ignoredScrollFrameRef.current);
      }
      ignoredScrollFrameRef.current = window.requestAnimationFrame(() => {
        ignoredScrollPaneRef.current = null;
        ignoredScrollFrameRef.current = null;
      });
    });
  };

  const handleMobileTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const nextPane: WorkspacePane =
      mobilePane === "source" ? "preview" : "source";
    setMobilePane(nextPane);
    window.requestAnimationFrame(() => {
      window.document.getElementById(`mobile-${nextPane}-tab`)?.focus();
    });
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleSaveCheckpoint = async () => {
    setIsSavingCheckpoint(true);
    setCheckpointStatus("Saving…");
    try {
      await saveCheckpoint({
        token: document.token,
        markdown,
        createdBy: anonymousName,
      });
      setCheckpointStatus("Saved");
      window.setTimeout(() => setCheckpointStatus("Save as checkpoint"), 1600);
    } catch (caught) {
      setCheckpointStatus(
        caught instanceof Error ? "Couldn’t save" : "Save failed",
      );
    } finally {
      setIsSavingCheckpoint(false);
    }
  };

  const openCheckpointComparison = () => {
    const historyRef =
      historyMenuPlacement === "desktop"
        ? desktopHistoryRef
        : mobileHistoryRef;
    comparisonOpenerRef.current =
      historyRef.current?.querySelector<HTMLElement>(".history-trigger") ??
      null;
    setHistoryMenuPlacement(null);
    setTopbarMenuOpen(false);
    setIsComparing(true);
  };

  const closeCheckpointComparison = useCallback(() => {
    setIsComparing(false);
    window.requestAnimationFrame(() => {
      const storedOpener = comparisonOpenerRef.current;
      const visibleHistoryTrigger = [
        desktopHistoryRef.current,
        mobileHistoryRef.current,
      ]
        .map((control) =>
          control?.querySelector<HTMLElement>(".history-trigger"),
        )
        .find(
          (trigger): trigger is HTMLElement =>
            trigger != null && trigger.offsetParent !== null,
        );
      const focusTarget =
        storedOpener !== null && storedOpener.offsetParent !== null
          ? storedOpener
          : visibleHistoryTrigger;
      focusTarget?.focus();
      comparisonOpenerRef.current = null;
    });
  }, []);

  const renderHistoryControl = (placement: "desktop" | "mobile") => {
    const isOpen = historyMenuPlacement === placement;
    const ref = placement === "desktop" ? desktopHistoryRef : mobileHistoryRef;
    return (
      <div
        className={`history-control history-control-${placement}`}
        ref={ref}
      >
        <button
          className="history-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={`${placement}-history-menu`}
          onClick={() =>
            setHistoryMenuPlacement(isOpen ? null : placement)
          }
        >
          History{checkpoints?.length ? ` · ${checkpoints.length}` : ""}
        </button>
        {isOpen ? (
          <div
            id={`${placement}-history-menu`}
            className="action-menu history-menu"
            role="menu"
            aria-label="Document history"
          >
            <p role="presentation">Document history</p>
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleSaveCheckpoint()}
              disabled={isSavingCheckpoint}
            >
              {checkpointStatus}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={openCheckpointComparison}
              disabled={!checkpoints || checkpoints.length < 2}
            >
              Compare checkpoints
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <main className={`editor-shell${isPreviewOnly ? " preview-only" : ""}`}>
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
            onClick={() => window.print()}
          >
            Export PDF
          </button>
          <div className="topbar-overflow" ref={topbarMenuRef}>
            <button
              className="overflow-trigger"
              type="button"
              aria-label="More document actions"
              aria-haspopup="menu"
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
                role="menu"
                aria-label="Document actions"
              >
                <button type="button" role="menuitem" onClick={() => void copyLink()}>
                  {copied ? "Link copied" : "Copy link"}
                </button>
                <button type="button" role="menuitem" onClick={() => window.print()}>
                  Export PDF
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setTopbarMenuOpen(false);
                    setIsPreviewOnly(true);
                  }}
                >
                  Full screen preview
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section className="workspace">
        <div className="mobile-workspace-rail">
          <div className="mobile-view-tabs" role="tablist" aria-label="Document view">
            <button
              id="mobile-source-tab"
              className="mobile-view-tab"
              type="button"
              role="tab"
              aria-selected={mobilePane === "source"}
              aria-controls="source-panel"
              tabIndex={mobilePane === "source" ? 0 : -1}
              onClick={() => setMobilePane("source")}
              onKeyDown={handleMobileTabKeyDown}
            >
              Markdown
            </button>
            <button
              id="mobile-preview-tab"
              className="mobile-view-tab"
              type="button"
              role="tab"
              aria-selected={mobilePane === "preview"}
              aria-controls="preview-panel"
              tabIndex={mobilePane === "preview" ? 0 : -1}
              onClick={() => setMobilePane("preview")}
              onKeyDown={handleMobileTabKeyDown}
            >
              Preview
            </button>
          </div>
          {renderHistoryControl("mobile")}
        </div>

        <section
          id="source-panel"
          className={`panel source-panel mobile-${mobilePane === "source" ? "active" : "inactive"}`}
        >
          <span className="pane-label" aria-hidden="true">Markdown</span>
          {renderHistoryControl("desktop")}
          <div
            className="editor-scroll"
            ref={sourceScrollRef}
            onScroll={() => handlePaneScroll("source")}
          >
            <EditorContent editor={editor} />
          </div>
        </section>

        <section
          id="preview-panel"
          className={`panel preview-panel mobile-${mobilePane === "preview" ? "active" : "inactive"}`}
        >
          <span className="pane-label" aria-hidden="true">Preview</span>
          <button
            className="panel-overlay-action preview-overlay-action"
            type="button"
            onClick={() => setIsPreviewOnly(true)}
          >
            Full screen preview
          </button>
          <article
            id="print-preview"
            className="preview-scroll markdown-body"
            ref={previewScrollRef}
            onScroll={() => handlePaneScroll("preview")}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkPreserveExtraBlankLines]}
            >
              {markdown}
            </ReactMarkdown>
          </article>
        </section>
      </section>

      {isPreviewOnly ? (
        <button
          className="preview-mode-exit"
          type="button"
          onClick={() => setIsPreviewOnly(false)}
          autoFocus
        >
          Exit preview
        </button>
      ) : null}

      {isComparing && checkpoints ? (
        <CheckpointCompareDialog
          checkpoints={checkpoints}
          olderId={olderId}
          newerId={newerId}
          comparison={comparison}
          onOlderChange={setOlderId}
          onNewerChange={setNewerId}
          onClose={closeCheckpointComparison}
        />
      ) : null}
    </main>
  );
}

function checkpointLabel(checkpoint: CheckpointSummary): string {
  const created = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(checkpoint.createdAt);
  return `${created} · ${checkpoint.createdBy} · ${checkpoint.charCount.toLocaleString()} chars`;
}

function CheckpointCompareDialog({
  checkpoints,
  olderId,
  newerId,
  comparison,
  onOlderChange,
  onNewerChange,
  onClose,
}: {
  checkpoints: CheckpointSummary[];
  olderId: Id<"checkpoints"> | null;
  newerId: Id<"checkpoints"> | null;
  comparison: CheckpointComparison | undefined;
  onOlderChange: (id: Id<"checkpoints">) => void;
  onNewerChange: (id: Id<"checkpoints">) => void;
  onClose: () => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const backdrop = backdropRef.current;
    const shell = backdrop?.parentElement;
    const isolatedSiblings = shell
      ? Array.from(shell.children)
          .filter(
            (element): element is HTMLElement =>
              element instanceof HTMLElement && element !== backdrop,
          )
          .map((element) => ({
            element,
            wasInert: element.hasAttribute("inert"),
            ariaHidden: element.getAttribute("aria-hidden"),
          }))
      : [];
    for (const { element } of isolatedSiblings) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }
    closeButtonRef.current?.focus();

    const containFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const activeElement = window.document.activeElement;
      if (!dialogRef.current?.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.document.addEventListener("keydown", containFocus, true);
    return () => {
      window.document.removeEventListener("keydown", containFocus, true);
      for (const { element, wasInert, ariaHidden } of isolatedSiblings) {
        if (!wasInert) {
          element.removeAttribute("inert");
        }
        if (ariaHidden === null) {
          element.removeAttribute("aria-hidden");
        } else {
          element.setAttribute("aria-hidden", ariaHidden);
        }
      }
    };
  }, [onClose]);

  return (
    <div
      className="checkpoint-backdrop"
      role="presentation"
      ref={backdropRef}
    >
      <section
        className="checkpoint-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkpoint-dialog-title"
        ref={dialogRef}
      >
        <header className="checkpoint-dialog-header">
          <div>
            <p className="eyebrow">Document history</p>
            <h2 id="checkpoint-dialog-title">Compare checkpoints</h2>
          </div>
          <button
            className="dialog-close"
            type="button"
            onClick={onClose}
            ref={closeButtonRef}
          >
            Close
          </button>
        </header>

        <div className="checkpoint-selectors">
          <label>
            Older
            <select
              value={olderId ?? ""}
              onChange={(event) =>
                onOlderChange(event.target.value as Id<"checkpoints">)
              }
            >
              {checkpoints.map((checkpoint) => (
                <option key={checkpoint._id} value={checkpoint._id}>
                  {checkpointLabel(checkpoint)}
                </option>
              ))}
            </select>
          </label>
          <span className="compare-arrow" aria-hidden="true">→</span>
          <label>
            Newer
            <select
              value={newerId ?? ""}
              onChange={(event) =>
                onNewerChange(event.target.value as Id<"checkpoints">)
              }
            >
              {checkpoints.map((checkpoint) => (
                <option key={checkpoint._id} value={checkpoint._id}>
                  {checkpointLabel(checkpoint)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {olderId === newerId ? (
          <div className="diff-status">Choose two different checkpoints.</div>
        ) : comparison === undefined ? (
          <div className="diff-status">Loading changes…</div>
        ) : (
          <CheckpointDiff comparison={comparison} />
        )}
      </section>
    </div>
  );
}

function CheckpointDiff({ comparison }: { comparison: CheckpointComparison }) {
  const rows = useMemo(
    () => buildDiffRows(comparison.older.markdown, comparison.newer.markdown),
    [comparison.newer.markdown, comparison.older.markdown],
  );
  const additions = rows.filter((row) => row.kind === "added").length;
  const removals = rows.filter((row) => row.kind === "removed").length;

  return (
    <div className="diff-shell">
      <div className="diff-summary">
        <span className="diff-added">+{additions} lines</span>
        <span className="diff-removed">−{removals} lines</span>
      </div>
      <div className="diff-table" role="table" aria-label="Checkpoint changes">
        {rows.length === 0 ? (
          <div className="diff-status">No changes between these checkpoints.</div>
        ) : (
          rows.map((row, index) => (
            <div className={`diff-row diff-row-${row.kind}`} role="row" key={`${index}-${row.kind}`}>
              <span className="diff-line-number" role="cell">{row.oldLine ?? ""}</span>
              <span className="diff-line-number" role="cell">{row.newLine ?? ""}</span>
              <span className="diff-marker" role="cell">
                {row.kind === "added" ? "+" : row.kind === "removed" ? "−" : " "}
              </span>
              <code role="cell">{row.value || " "}</code>
            </div>
          ))
        )}
      </div>
    </div>
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
