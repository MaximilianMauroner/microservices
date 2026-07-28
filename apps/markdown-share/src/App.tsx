import usePresence from "@convex-dev/presence/react";
import { useTiptapSync } from "@convex-dev/prosemirror-sync/tiptap";
import CodeBlock from "@tiptap/extension-code-block";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Content } from "@tiptap/core";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../convex/_generated/api";
import {
  documentPath,
  formatExpiry,
  getAnonymousName,
  initialMarkdown,
  markdownFromJson,
  normalizeFilename,
  parseDocumentRoute,
} from "./lib";

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
    const token = crypto.randomUUID();
    setIsCreating(true);
    setError(null);

    try {
      await createDocument({
        filename,
        token,
        markdown: initialMarkdown(filename),
      });
      window.location.assign(documentPath(filename, token));
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
  const anonymousName = useMemo(getAnonymousName, []);
  const presence = usePresence(
    api.presence,
    document.token,
    anonymousName,
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
      anonymousName={anonymousName}
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
  const online = presence.filter((entry) => entry.online);
  const editor = useEditor({
    extensions: [
      Document,
      Text,
      CodeBlock.configure({
        exitOnArrowDown: false,
        exitOnTripleEnter: false,
      }),
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

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="editor-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Markdown Share home">
          <span className="wordmark-icon">M↓</span>
          <span>Markdown Share</span>
        </a>

        <div className="document-identity">
          <strong>{document.filename}</strong>
          <span>expires in {formatExpiry(document.expiresAt)}</span>
        </div>

        <div className="topbar-actions">
          <div className="presence-cluster" aria-label={`${online.length} online`}>
            {online.slice(0, 3).map((entry) => (
              <span
                className="presence-avatar"
                key={entry.userId}
                title={entry.userId}
              >
                {entry.userId.slice(0, 1)}
              </span>
            ))}
            <span className="presence-label">
              {online.length || 1} online
            </span>
          </div>
          <button className="button-secondary" type="button" onClick={copyLink}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <button
            className="button-primary"
            type="button"
            onClick={() => window.print()}
          >
            Export PDF
          </button>
        </div>
      </header>

      <div className="retention-note">
        <span className="live-dot" />
        Editing as <strong>{anonymousName}</strong>. Each accepted edit renews
        the seven-day window.
      </div>

      <section className="workspace">
        <section className="panel source-panel">
          <header className="panel-toolbar">
            <span>Markdown</span>
            <span className="panel-meta">literal source</span>
          </header>
          <div className="editor-scroll">
            <EditorContent editor={editor} />
          </div>
        </section>

        <section className="panel preview-panel">
          <header className="panel-toolbar">
            <span>Preview</span>
            <span className="panel-meta">GitHub-flavored</span>
          </header>
          <article id="print-preview" className="preview-scroll markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
          </article>
        </section>
      </section>
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
