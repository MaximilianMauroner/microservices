// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedbackForm, FeedbackSubmission } from "../../../products/feedback/domain.js";

const api = vi.hoisted(() => ({ deleteForm: vi.fn(), deleteResponse: vi.fn(), rotate: vi.fn(), navigate: vi.fn(), invalidate: vi.fn(), blocker: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>, useRouter: () => ({ invalidate: api.invalidate }), useNavigate: () => api.navigate, useBlocker: api.blocker }));
vi.mock("../../../platform/ui/components/app-shell.js", () => ({ AppShell: () => null }));
vi.mock("../../../products/feedback/server-functions.js", () => ({ createFeedbackForm: vi.fn(), deleteFeedbackForm: api.deleteForm, deleteFeedbackSubmission: api.deleteResponse, rotateFeedbackToken: api.rotate, setFeedbackFormStatus: vi.fn(), updateFeedbackForm: vi.fn(), updateFeedbackSubmission: vi.fn() }));
import { FeedbackFormPage, FeedbackHome, FeedbackInbox, FeedbackResponsePage } from "../../../products/feedback/ui.js";

const form: FeedbackForm = { id: "form-1", publicToken: "token", language: "en", title: "Workshop", introduction: "Intro", questions: [], status: "active", createdAt: "2026-09-27T08:00:00.000Z", updatedAt: "2026-09-27T08:00:00.000Z", responseCount: 2, unreadCount: 2 };
const response: FeedbackSubmission = { id: "response-1", formId: form.id, formTitle: form.title, questionSnapshot: [], answers: { identity: "Alice" }, submittedAt: "2026-09-27T08:00:00.000Z", reviewState: "unread", followUpState: "none" };
const secondResponse = { ...response, id: "response-2", answers: { identity: "Bob" } };
const secondForm = { ...form, id: "form-2", title: "Other", responseCount: 3 };

function button(text: string, scope: ParentNode = document.body) {
  const found = Array.from(scope.querySelectorAll("button")).find((item) => item.textContent?.trim() === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}
function dialog() {
  const found = document.querySelector<HTMLElement>('[role="alertdialog"]');
  if (!found) throw new Error("Confirmation dialog not found");
  return found;
}
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function key(target: EventTarget, value: string) { await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }))); }

describe("feedback action confirmations", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.values(api).forEach((mock) => mock.mockReset().mockResolvedValue(undefined));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it("confirms selected response deletion by keyboard and preserves partial failures", async () => {
    api.deleteResponse.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("offline"));
    await act(async () => root.render(<FeedbackInbox forms={[form]} submissions={[response, secondResponse]} />));
    await click(container.querySelector<HTMLInputElement>('[aria-label="Select response from Alice"]')!);
    await click(container.querySelector<HTMLInputElement>('[aria-label="Select response from Bob"]')!);
    await key(document.body, "Delete");
    expect(dialog().textContent).toContain("Delete 2 selected responses?");
    expect(api.deleteResponse).not.toHaveBeenCalled();
    await click(button("Cancel", dialog()));
    expect(api.deleteResponse).not.toHaveBeenCalled();
    await click(button("Delete selected…", container));
    await click(button("Delete responses", dialog()));
    expect(api.deleteResponse).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("1 deleted. offline");
    expect(container.querySelector('[aria-label="Select response from Alice"]')).toBeNull();
    expect(container.querySelector('[aria-label="Select response from Bob"]')).not.toBeNull();
  });

  it("confirms selected form deletion by keyboard and reports the number of responses", async () => {
    api.deleteForm.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("offline"));
    await act(async () => root.render(<FeedbackHome forms={[form, secondForm]} />));
    await click(container.querySelector<HTMLInputElement>('[aria-label="Select all forms"]')!);
    await key(document.body, "Delete");
    expect(dialog().textContent).toContain("5 responses");
    await click(button("Cancel", dialog()));
    expect(api.deleteForm).not.toHaveBeenCalled();
    await key(document.body, "Delete");
    await click(button("Delete forms", dialog()));
    expect(api.deleteForm).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("1 deleted. offline");
    expect(container.querySelector('[aria-label="Select Workshop"]')).toBeNull();
    expect(container.querySelector('[aria-label="Select Other"]')).not.toBeNull();
  });

  it("ignores the Delete shortcut in editable fields", async () => {
    await act(async () => root.render(<FeedbackInbox forms={[form]} submissions={[response]} />));
    await click(container.querySelector<HTMLInputElement>('[aria-label="Select response from Alice"]')!);
    const input = document.createElement("input"); container.append(input);
    await key(input, "Delete");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(api.deleteResponse).not.toHaveBeenCalled();
    input.remove();
  });

  it("disables deletion and the shortcut while another action is pending", async () => {
    let finish!: () => void;
    api.deleteForm.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    await act(async () => root.render(<FeedbackHome forms={[form]} />));
    await click(container.querySelector<HTMLInputElement>('[aria-label="Select Workshop"]')!);
    await click(button("Delete selected…", container));
    await click(button("Delete forms", dialog()));
    expect(button("Delete selected…", container).disabled).toBe(true);
    await key(document.body, "Delete");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(api.deleteForm).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("keeps the unsaved navigation blocker and permits navigation after deletion", async () => {
    await act(async () => root.render(<FeedbackFormPage form={form} submissions={[]} publicOrigin="https://example.test" />));
    const title = container.querySelector<HTMLInputElement>('input[placeholder="Enter a title"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(title, "Changed"); title.dispatchEvent(new Event("input", { bubbles: true })); });
    const options = api.blocker.mock.lastCall![0];
    expect(options.disabled).toBe(false);
    expect(options.enableBeforeUnload).toBe(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(options.shouldBlockFn()).toBe(true);
    await click(button("Delete permanently", container));
    await click(button("Delete form", dialog()));
    expect(options.shouldBlockFn()).toBe(false);
    confirm.mockRestore();
  });

  it("confirms form deletion and link rotation separately", async () => {
    await act(async () => root.render(<FeedbackFormPage form={form} submissions={[]} publicOrigin="https://example.test" />));
    await click(button("Rotate link", container));
    expect(dialog().textContent).toContain("current public link will stop working");
    await click(button("Cancel", dialog()));
    expect(api.rotate).not.toHaveBeenCalled();
    await click(button("Rotate link", container));
    await click(button("Rotate link", dialog()));
    expect(api.rotate).toHaveBeenCalledWith({ data: { formId: form.id } });
    await click(button("Delete permanently", container));
    expect(dialog().textContent).toContain("all 2 responses");
    await click(button("Cancel", dialog()));
    expect(api.deleteForm).not.toHaveBeenCalled();
    await click(button("Delete permanently", container));
    await click(button("Delete form", dialog()));
    expect(api.deleteForm).toHaveBeenCalledWith({ data: { formId: form.id } });
    expect(api.navigate).toHaveBeenCalledWith({ to: "/feedback" });
  });

  it("confirms individual response deletion and shows errors", async () => {
    api.deleteResponse.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    await act(async () => root.render(<FeedbackResponsePage submission={response} />));
    await click(button("Delete permanently", container));
    await click(button("Cancel", dialog()));
    expect(api.deleteResponse).not.toHaveBeenCalled();
    await click(button("Delete permanently", container));
    await click(button("Delete response", dialog()));
    expect(container.textContent).toContain("offline");
    expect(api.navigate).not.toHaveBeenCalled();
    await click(button("Delete permanently", container));
    await click(button("Delete response", dialog()));
    expect(api.deleteResponse).toHaveBeenCalledWith({ data: { submissionId: response.id } });
    expect(api.navigate).toHaveBeenCalledWith({ to: "/feedback/forms/$formId", params: { formId: form.id } });
  });
});
