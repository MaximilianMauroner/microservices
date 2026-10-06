import { Extension, type AnyExtension, type Content } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions/undo-redo";
import { useEditor } from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";
import { sourceSizeError } from "@tools-platform/markdown-share/source-limits";
import { getVersion, sendableSteps } from "prosemirror-collab";
import { useCallback, useEffect, useRef, useState } from "react";
import { markdownFromJson } from "./lib.js";

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

  if (structuredErrorCode(error) === "DOCUMENT_TOO_LARGE") {
    return {
      kind: "retryable",
      message: "The document exceeds the save size limit. Undo or shorten your latest edit. Copy your source before leaving this page.",
    };
  }

  return {
    kind: "retryable",
    message:
      "Changes could not be synchronized. Your latest edits may not be saved. Keep this page open and copy your source before leaving. Try editing again to retry.",
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

  const onSyncRecovered = useCallback(() => {
    setFailure((current) => current?.kind === "document-unavailable" ? current : null);
  }, []);
  return { failure, onSyncError, onSyncRecovered };
}

/** Owns editor content, save state, and permissions for one live document. */
export function useLiveDocumentEditor({
  initialContent,
  syncExtension,
  syncFailure,
  onSyncRecovered,
}: {
  initialContent: Content;
  syncExtension: AnyExtension;
  syncFailure: SyncFailure | null;
  onSyncRecovered: () => void;
}) {
  const [markdown, setMarkdown] = useState(() =>
    markdownFromJson(initialContent),
  );
  const [inputError, setInputError] = useState<string | null>(null);
  const acknowledgedVersion = useRef<number | null>(null);
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
      Extension.create({
        name: "source-size-limit",
        addProseMirrorPlugins() {
          return [new Plugin({
            filterTransaction(transaction) {
              if (!transaction.docChanged || transaction.getMeta("rebased") !== undefined) return true;
              const source = transaction.doc.textBetween(0, transaction.doc.content.size, "\n");
              const error = sourceSizeError(source);
              setInputError(error ? `Edit not applied. ${error}` : null);
              return error === null;
            },
          })];
        },
      }),
      syncExtension,
    ],
    content: initialContent,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        "aria-label": "Document source",
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
      const version = getVersion(editor.state);
      const hasPendingSteps = sendableSteps(editor.state) !== null;
      if (acknowledgedVersion.current !== null && version > acknowledgedVersion.current && !hasPendingSteps) {
        onSyncRecovered();
      }
      acknowledgedVersion.current = version;
      setSaveStatus(
        editorSaveStatus(hasPendingSteps, syncFailure),
      );
    };
    editor.on("transaction", updateSession);
    updateSession();
    return () => {
      editor.off("transaction", updateSession);
    };
  }, [editor, syncFailure, onSyncRecovered]);

  useEffect(() => {
    editor?.setEditable(!documentUnavailable);
  }, [documentUnavailable, editor]);

  return {
    editor,
    inputError,
    markdown,
    saveStatus,
    saveLabel: editorSaveLabel(saveStatus),
    canCreateCheckpoint: !documentUnavailable,
  };
}
