import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

export type WorkspacePane = "source" | "preview";

export function getScrollProgress(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const scrollableHeight = Math.max(0, scrollHeight - clientHeight);
  if (scrollableHeight === 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, scrollTop / scrollableHeight));
}

export function getScrollTop(
  progress: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const scrollableHeight = Math.max(0, scrollHeight - clientHeight);
  return Math.min(1, Math.max(0, progress)) * scrollableHeight;
}

/** Coordinates source and preview viewport state, browser events, and scroll. */
export function useWorkspaceViewport() {
  const [mobilePane, setMobilePane] = useState<WorkspacePane>("source");
  const [isPreviewOnly, setIsPreviewOnly] = useState(false);
  const sourceScrollRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLElement>(null);
  const scrollProgressRef = useRef(0);
  const pendingScrollPaneRef = useRef<WorkspacePane | null>(null);
  const scrollSyncFrameRef = useRef<number | null>(null);
  const ignoredScrollPaneRef = useRef<WorkspacePane | null>(null);
  const ignoredScrollFrameRef = useRef<number | null>(null);

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
      const element = isPreviewOnly
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
    event: ReactKeyboardEvent<HTMLButtonElement>,
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

  return {
    sourceScrollRef,
    previewScrollRef,
    mobilePane,
    setMobilePane,
    isPreviewOnly,
    enterPreviewOnly: () => setIsPreviewOnly(true),
    exitPreviewOnly: () => setIsPreviewOnly(false),
    handlePaneScroll,
    handleMobileTabKeyDown,
  };
}
