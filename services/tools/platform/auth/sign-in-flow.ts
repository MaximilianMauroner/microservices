import { safeReturnPath } from "./return-path.js";

type SignInFlow = {
  callbackURL: string;
  errorCallbackURL: string;
  authenticatedRedirect?: string;
};

export function signInFlow(search: string): SignInFlow {
  const query = new URLSearchParams(search);
  const returnTo = safeReturnPath(query.get("returnTo"));
  if (!query.get("sig")) {
    return {
      callbackURL: returnTo,
      errorCallbackURL: `/sign-in?${new URLSearchParams({ returnTo })}`,
      authenticatedRedirect: returnTo
    };
  }

  const retryQuery = new URLSearchParams(query);
  retryQuery.delete("error");
  const authorizationQuery = new URLSearchParams(query);
  for (const key of ["sig", "exp", "ba_iat", "ba_pl", "ba_param", "returnTo", "reason", "error"]) {
    authorizationQuery.delete(key);
  }
  const prompts = (authorizationQuery.get("prompt") ?? "").split(" ")
    .filter((prompt) => prompt && prompt !== "login" && prompt !== "select_account");
  if (prompts.length) authorizationQuery.set("prompt", prompts.join(" "));
  else authorizationQuery.delete("prompt");

  return {
    callbackURL: `/api/auth/oauth2/authorize?${authorizationQuery}`,
    errorCallbackURL: `/sign-in?${retryQuery}`
  };
}
