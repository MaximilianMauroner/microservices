// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Route as ReviewRoute, ReviewSignInPanel } from "../../../app/routes/app-review.js";
import { SignInPanel } from "../../../app/routes/sign-in.js";

it("submits credentials only on the separate review page", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const submit = vi.fn();
  try {
    await act(async () => root.render(<ReviewSignInPanel onSignIn={submit} />));
    expect(host.textContent).toContain("App Review sign-in");
    const username = host.querySelector<HTMLInputElement>('input[name="username"]')!;
    const password = host.querySelector<HTMLInputElement>('input[name="password"]')!;
    expect(username.autocomplete).toBe("username");
    expect(password.type).toBe("password");
    expect(password.autocomplete).toBe("current-password");
    username.value = "apple-review";
    password.value = "test-review-password";
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(submit).toHaveBeenCalledWith("apple-review", "test-review-password");
    await act(async () => root.render(<ReviewSignInPanel submitting error="Sign-in failed." onSignIn={submit} />));
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Sign-in failed.");
    expect([...host.querySelectorAll("button, input")].every((element) => (element as HTMLInputElement).disabled)).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps review credentials off normal sign-in and opens the unlisted entry after five logo taps", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const reviewEntry = vi.fn();
  try {
    await act(async () => root.render(<SignInPanel state="sign-in" onReviewEntry={reviewEntry} />));
    expect(host.textContent).not.toContain("App Review");
    expect(host.querySelector("form, input, a[href='/app-review']")).toBeNull();
    const logo = host.querySelector<HTMLButtonElement>('button[aria-label="Mauroner Tools"]')!;
    for (let i = 0; i < 4; i++) await act(async () => logo.click());
    expect(reviewEntry).not.toHaveBeenCalled();
    await act(async () => logo.click());
    expect(reviewEntry).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});


it("keeps the signed app request on the unlisted route and excludes the page from search indexes", () => {
  const query = { sig: "signed-query", client_id: "com.lab4code.pantrino", state: "native-state", code_challenge: "pkce", ba_param: ["state", "code_challenge"] };
  const validate = ReviewRoute.options.validateSearch as (search: Record<string, unknown>) => Record<string, unknown>;
  expect(validate(query)).toEqual(query);
  const head = (ReviewRoute.options.head as () => { meta: Record<string, string>[] })();
  expect(head.meta).toContainEqual({ name: "robots", content: "noindex, nofollow, noarchive" });
});
