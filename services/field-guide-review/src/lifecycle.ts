export function createGracefulShutdown(options: {
  stop: (force: boolean) => void | Promise<void>;
  close: () => Promise<void>;
  fail: () => void;
  report: (error: unknown) => void;
  timeoutMs?: number;
}) {
  let shutdown: Promise<void> | undefined;
  return () => {
    shutdown ??= (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let failed = false;
      const markFailed = () => {
        if (failed) return;
        failed = true;
        options.fail();
      };
      let graceful = false;
      try {
        const drained = Promise.resolve()
          .then(() => options.stop(false))
          .then(() => true);
        const timedOut = new Promise<false>((resolve) => {
          timeout = setTimeout(
            () => resolve(false),
            options.timeoutMs ?? 10_000,
          );
          timeout.unref?.();
        });
        graceful = await Promise.race([drained, timedOut]);
      } catch (error) {
        markFailed();
        options.report(error);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      if (!graceful) {
        markFailed();
        try {
          await options.stop(true);
        } catch (error) {
          options.report(error);
        }
      }
      try {
        await options.close();
      } catch (error) {
        markFailed();
        options.report(error);
      }
    })();
    return shutdown;
  };
}
