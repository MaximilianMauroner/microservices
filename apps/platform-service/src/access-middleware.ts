import { createMiddleware } from "@tanstack/react-start";
import type { AccessFamily, AccessVerifier } from "@tools-platform/security";

type PlatformFunctionContext = {
  request: Request;
    runtime: {
      access: Record<AccessFamily, AccessVerifier>;
      readOnly?: boolean;
      localAuth?: boolean;
  };
};

export function createPlatformAccessFunctionMiddleware(family: AccessFamily) {
  return createMiddleware({ type: "function" }).server(async ({ context, next }) => {
    const platformContext = context as PlatformFunctionContext;
    if (platformContext.runtime.localAuth ||
      (platformContext.runtime.readOnly &&
        (platformContext.request.method === "GET" ||
          platformContext.request.method === "HEAD"))) {
      return next({
        context: { accessActor: { id: platformContext.runtime.localAuth ? "local@localhost" : "design@local.invalid" } }
      });
    }
    const actor = await platformContext.runtime.access[family].verify(platformContext.request);
    return next({ context: { accessActor: actor } });
  });
}
