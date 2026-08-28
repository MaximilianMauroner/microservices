import { useMutation, useQuery } from "convex/react";
import { diffLines } from "diff";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@tools-platform/markdown-share/api";
import type { Id } from "@tools-platform/markdown-share/data-model";

type CheckpointSummary = {
  _id: Id<"checkpoints">;
  createdAt: number;
  createdBy: string;
  charCount: number;
  version?: number;
};

type CheckpointComparison = {
  older: Omit<CheckpointSummary, "charCount"> & { markdown: string };
  newer: Omit<CheckpointSummary, "charCount"> & { markdown: string };
};

export type DiffRow = {
  kind: "added" | "removed" | "unchanged";
  value: string;
  oldLine: number | null;
  newLine: number | null;
};

export function buildDiffRows(older: string, newer: string): DiffRow[] {
  let oldLine = 1;
  let newLine = 1;

  return diffLines(older, newer).flatMap((part) => {
    const lines = part.value.split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }

    return lines.map((value) => {
      const kind = part.added
        ? "added"
        : part.removed
          ? "removed"
          : "unchanged";
      const row: DiffRow = {
        kind,
        value,
        oldLine: kind === "added" ? null : oldLine,
        newLine: kind === "removed" ? null : newLine,
      };
      if (kind !== "added") {
        oldLine += 1;
      }
      if (kind !== "removed") {
        newLine += 1;
      }
      return row;
    });
  });
}

function checkpointLabel(checkpoint: CheckpointSummary): string {
  const created = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(checkpoint.createdAt);
  return `${created} · ${checkpoint.createdBy} · ${checkpoint.charCount.toLocaleString()} chars`;
}

/** Owns checkpoint creation, comparison selection, menus, dialog, and focus. */
export function useDocumentHistory({
  token,
  createdBy,
  canCreateCheckpoint,
}: {
  token: string;
  createdBy: string;
  canCreateCheckpoint: boolean;
}) {
  const [checkpointStatus, setCheckpointStatus] = useState("Save as checkpoint");
  const [isSavingCheckpoint, setIsSavingCheckpoint] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<
    "desktop" | "mobile" | null
  >(null);
  const [olderId, setOlderId] = useState<Id<"checkpoints"> | null>(null);
  const [newerId, setNewerId] = useState<Id<"checkpoints"> | null>(null);
  const desktopControlRef = useRef<HTMLDivElement>(null);
  const mobileControlRef = useRef<HTMLDivElement>(null);
  const comparisonOpenerRef = useRef<HTMLElement | null>(null);
  const checkpoints = useQuery(api.checkpoints.list, { token });
  const saveCheckpoint = useMutation(api.checkpoints.create);
  const comparison = useQuery(
    api.checkpoints.compare,
    isComparing && olderId && newerId && olderId !== newerId
      ? { token, olderId, newerId }
      : "skip",
  );

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
    if (menuPlacement === null) {
      return;
    }
    const controlRef =
      menuPlacement === "desktop" ? desktopControlRef : mobileControlRef;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !controlRef.current?.contains(target)) {
        setMenuPlacement(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      setMenuPlacement(null);
      controlRef.current
        ?.querySelector<HTMLButtonElement>(".history-trigger")
        ?.focus();
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    const frame = window.requestAnimationFrame(() => {
      controlRef.current
        ?.querySelector<HTMLButtonElement>(".action-menu button:not(:disabled)")
        ?.focus();
    });
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
      window.cancelAnimationFrame(frame);
    };
  }, [menuPlacement]);

  const handleSaveCheckpoint = async () => {
    if (!canCreateCheckpoint) {
      return;
    }
    setIsSavingCheckpoint(true);
    setCheckpointStatus("Saving…");
    try {
      await saveCheckpoint({ token, createdBy });
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

  const openComparison = (placement: "desktop" | "mobile") => {
    const controlRef =
      placement === "desktop" ? desktopControlRef : mobileControlRef;
    comparisonOpenerRef.current =
      controlRef.current?.querySelector<HTMLElement>(".history-trigger") ??
      null;
    setMenuPlacement(null);
    setIsComparing(true);
  };

  const closeComparison = useCallback(() => {
    setIsComparing(false);
    window.requestAnimationFrame(() => {
      const storedOpener = comparisonOpenerRef.current;
      const visibleHistoryTrigger = [
        desktopControlRef.current,
        mobileControlRef.current,
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

  const renderControl = (placement: "desktop" | "mobile") => {
    const isOpen = menuPlacement === placement;
    const ref = placement === "desktop" ? desktopControlRef : mobileControlRef;
    return (
      <div className={`history-control history-control-${placement}`} ref={ref}>
        <button
          className="history-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={`${placement}-history-menu`}
          onClick={() => setMenuPlacement(isOpen ? null : placement)}
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
              disabled={isSavingCheckpoint || !canCreateCheckpoint}
            >
              {checkpointStatus}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => openComparison(placement)}
              disabled={!checkpoints || checkpoints.length < 2}
            >
              Compare checkpoints
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  return {
    renderControl,
    dialog:
      isComparing && checkpoints ? (
        <CheckpointCompareDialog
          checkpoints={checkpoints}
          olderId={olderId}
          newerId={newerId}
          comparison={comparison}
          onOlderChange={setOlderId}
          onNewerChange={setNewerId}
          onClose={closeComparison}
        />
      ) : null,
  };
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
    <div className="checkpoint-backdrop" role="presentation" ref={backdropRef}>
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
            <div
              className={`diff-row diff-row-${row.kind}`}
              role="row"
              key={`${index}-${row.kind}`}
            >
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
