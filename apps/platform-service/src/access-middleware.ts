import { createMiddleware } from "@tanstack/react-start";
import type { AccessFamily, AccessVerifier } from "@tools-platform/security";

type PlatformFunctionContext = {
  request: Request;
  runtime: {
    access: Record<AccessFamily, AccessVerifier>;
  };
};

export function createPlatformAccessFunctionMiddleware(family: AccessFamily) {
  return createMiddleware({ type: "function" }).server(async ({ context, next }) => {
    const platformContext = context as PlatformFunctionContext;
    const actor = await platformContext.runtime.access[family].verify(platformContext.request);
    return next({ context: { accessActor: actor } });
  });
}
