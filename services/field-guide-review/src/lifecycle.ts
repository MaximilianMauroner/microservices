export function createGracefulShutdown(options: {
  stop: (force: boolean) => void | Promise<void>;
  checkpoint?: () => void | Promise<void>;
  close: () => Promise<void>;
  fail: () => void;
  terminate?: () => void;
  report: (error: unknown) => void;
  timeoutMs?: number;
}) {
  let shutdown: Promise<void> | undefined;
  return () => {
    shutdown ??= (async () => {
      let failed = false;
      const markFailed = () => {
        if (failed) return;
        failed = true;
        options.fail();
      };
      const observe = (
        operation: () => void | Promise<void>,
        onError?: () => void,
      ) =>
        Promise.resolve()
          .then(operation)
          .catch((error: unknown) => {
            onError?.();
            markFailed();
            options.report(error);
          });
      let closePromise: Promise<void> | undefined;
      const close = () =>
        (closePromise ??= observe(() => options.close()));
      let checkpointPromise: Promise<void> | undefined;
      const checkpoint = () =>
        (checkpointPromise ??= observe(() => options.checkpoint?.()));
      let forcePromise: Promise<void> | undefined;
      const force = () =>
        (forcePromise ??= observe(() => options.stop(true)));
      let drainFailed = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<"deadline">((resolve) => {
        timeout = setTimeout(
          () => resolve("deadline"),
          options.timeoutMs ?? 10_000,
        );
        timeout.unref?.();
      });
      const work = (async () => {
        await observe(
          () => options.stop(false),
          () => {
            drainFailed = true;
          },
        );
        if (drainFailed) void force();
        await checkpoint();
        await Promise.all([close(), ...(drainFailed ? [force()] : [])]);
      })();
      const outcome = await Promise.race([
        work.then(() => "complete" as const),
        deadline,
      ]);
      if (timeout) clearTimeout(timeout);
      if (outcome === "deadline") {
        markFailed();
        void force();
        void checkpoint();
        void close();
        options.terminate?.();
      }
    })();
    return shutdown;
  };
}
