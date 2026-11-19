import { useCallback, useEffect, useRef, useState } from "react";

type CopyResult = { readonly ok: boolean; readonly key: string };

/**
 * One clipboard outcome at a time. A success shows for `resetMs`, then clears.
 * A failure stays until the next copy. `key` tells copy buttons in one list apart.
 */
export function useCopyToClipboard(resetMs = 2000) {
  const [result, setResult] = useState<CopyResult>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string, key = "") => {
    const attempt = ++latest.current;
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      if (attempt !== latest.current) return;
      setResult({ ok: true, key });
      timer.current = setTimeout(() => setResult(undefined), resetMs);
    } catch {
      if (attempt !== latest.current) return;
      setResult({ ok: false, key });
    }
  }, [resetMs]);

  return {
    copy,
    copied: (key = "") => result?.ok === true && result.key === key,
    failed: result?.ok === false
  };
}
