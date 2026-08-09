import type { AnyExtension, Content } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions/undo-redo";
import { useEditor } from "@tiptap/react";
import { sendableSteps } from "prosemirror-collab";
import { useCallback, useEffect, useState } from "react";
import { markdownFromJson } from "./lib";

type SyncFailureKind = "document-unavailable" | "retryable";

export type SyncFailure = {
  kind: SyncFailureKind;
  message: string;
};

export type EditorSaveStatus = "saved" | "saving" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structuredErrorCode(error: Error): string | null {
  if (!("data" in error) || !isRecord(error.data)) {
    return null;
  }
  return typeof error.data.code === "string" ? error.data.code : null;
}

export function classifySyncError(error: Error): SyncFailure {
  if (structuredErrorCode(error) === "DOCUMENT_UNAVAILABLE") {
    return {
      kind: "document-unavailable",
      message:
        "This document is no longer available. Editing and new checkpoints are disabled. Copy any unsaved text before leaving this page.",
    };
  }

  return {
    kind: "retryable",
    message:
      "Changes could not be synchronized. Your latest edits may not be saved; try editing again, reloading, or reopening this page.",
  };
}

export function editorSaveStatus(
  hasPendingSteps: boolean,
  syncFailure: SyncFailure | null,
): EditorSaveStatus {
  if (syncFailure !== null) {
    return "error";
  }
  return hasPendingSteps ? "saving" : "saved";
}

export function editorSaveLabel(status: EditorSaveStatus): string {
  switch (status) {
    case "saved":
      return "Saved";
    case "saving":
      return "Saving…";
    case "error":
      return "Save failed";
  }
}

/** Owns sync failure classification and preserves terminal document loss. */
export function useSyncFailure() {
  const [failure, setFailure] = useState<SyncFailure | null>(null);
  const onSyncError = useCallback((error: Error) => {
    const nextFailure = classifySyncError(error);
    setFailure((current) =>
      current?.kind === "document-unavailable" ? current : nextFailure,
    );
  }, []);

  return { failure, onSyncError };
}

/** Owns editor content, save state, and permissions for one live document. */
export function useLiveDocumentEditor({
  initialContent,
  syncExtension,
  syncFailure,
}: {
  initialContent: Content;
  syncExtension: AnyExtension;
  syncFailure: SyncFailure | null;
}) {
  const [markdown, setMarkdown] = useState(() =>
    markdownFromJson(initialContent),
  );
  const [saveStatus, setSaveStatus] = useState<EditorSaveStatus>("saved");
  const documentUnavailable = syncFailure?.kind === "document-unavailable";
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
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    const updateSession = () => {
      setMarkdown(
        editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n"),
      );
      setSaveStatus(
        editorSaveStatus(sendableSteps(editor.state) !== null, syncFailure),
      );
    };
    editor.on("transaction", updateSession);
    updateSession();
    return () => {
      editor.off("transaction", updateSession);
    };
  }, [editor, syncFailure]);

  useEffect(() => {
    editor?.setEditable(!documentUnavailable);
  }, [documentUnavailable, editor]);

  return {
    editor,
    markdown,
    saveStatus,
    saveLabel: editorSaveLabel(saveStatus),
    canCreateCheckpoint: !documentUnavailable,
  };
}
