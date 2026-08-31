export const POSTGRES_READINESS_RETRY_DELAYS_MS = [
  1_000,
  2_000,
  4_000,
  8_000,
  10_000
] as const;

type ReadinessCheck = () => Promise<void>;
type Wait = (milliseconds: number) => Promise<void>;
type RetryObserver = (retry: { attempt: number; delayMs: number }) => void;

export async function waitForPostgres(
  check: ReadinessCheck,
  retryDelaysMs: readonly number[] = POSTGRES_READINESS_RETRY_DELAYS_MS,
  wait: Wait = waitForDelay,
  onRetry: RetryObserver = () => {}
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await check();
      return;
    } catch (error) {
      const delayMs = retryDelaysMs[attempt];
      if (delayMs === undefined) throw error;
      onRetry({ attempt: attempt + 1, delayMs });
      await wait(delayMs);
    }
  }
}

function waitForDelay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
