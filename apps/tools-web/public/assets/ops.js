(() => {
  "use strict";

  const root = document.querySelector("[data-ops-root]");
  if (!(root instanceof HTMLElement)) return;

  const status = document.querySelector("[data-mutation-status]");
  const conflictDialog = document.querySelector("[data-conflict-dialog]");
  const deleteDialog = document.querySelector("[data-delete-dialog]");

  const setStatus = (message, kind = "pending") => {
    if (!(status instanceof HTMLElement)) return;
    status.textContent = message;
    status.className = `notice notice--${kind}`;
    status.hidden = false;
  };

  const currentRevision = () => root.dataset.revision ?? "";

  const request = async (url, method, body) => {
    setStatus("Saving…");
    let response;
    try {
      response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "If-Match": `"${currentRevision()}"`
        },
        body: method === "DELETE" ? undefined : JSON.stringify(body)
      });
    } catch {
      setStatus("The request could not reach the server. Nothing was changed.", "error");
      return;
    }

    const payload = await response.json().catch(() => ({}));
    if (response.status === 409) {
      setStatus("Change not applied because the catalog changed.", "error");
      showConflict(payload);
      return;
    }
    if (!response.ok) {
      const message =
        typeof payload.message === "string"
          ? payload.message
          : `Change failed (HTTP ${response.status}).`;
      setStatus(message, "error");
      return;
    }
    setStatus("Saved. Loading the current catalog…", "success");
    window.location.reload();
  };

  const formBody = (form) => {
    const body = {};
    for (const [key, value] of new FormData(form).entries()) {
      if (typeof value !== "string") continue;
      if (key === "_method") continue;
      if (key === "links") {
        body.links = value.trim() === "" ? [] : JSON.parse(value);
        continue;
      }
      if (key.startsWith("monitor.")) {
        body.monitor ??= {};
        body.monitor[key.slice("monitor.".length)] = value;
        continue;
      }
      body[key] = value;
    }
    for (const checkbox of form.querySelectorAll('input[type="checkbox"][name]')) {
      if (!(checkbox instanceof HTMLInputElement)) continue;
      if (checkbox.name.startsWith("monitor.")) {
        body.monitor ??= {};
        body.monitor[checkbox.name.slice("monitor.".length)] = checkbox.checked;
      } else {
        body[checkbox.name] = checkbox.checked;
      }
    }
    return body;
  };

  const showConflict = (payload) => {
    if (!(conflictDialog instanceof HTMLDialogElement)) return;
    const detail = conflictDialog.querySelector("[data-conflict-detail]");
    if (detail instanceof HTMLElement && typeof payload.revision === "string") {
      detail.textContent = `Latest revision: ${payload.revision}`;
    }
    conflictDialog.showModal();
  };

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-json-form]")) return;
    event.preventDefault();
    let body;
    try {
      body = formBody(form);
    } catch {
      setStatus("Links JSON is invalid. Correct it before saving.", "error");
      return;
    }
    const override = new FormData(form).get("_method");
    const method = typeof override === "string" ? override : form.method.toUpperCase();
    void request(form.action, method, body);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const reveal = target.closest("[data-reveal]");
    if (reveal instanceof HTMLElement) {
      const panel = document.getElementById(reveal.dataset.reveal ?? "");
      if (panel instanceof HTMLElement) {
        panel.hidden = false;
        panel.querySelector("input, select, textarea")?.focus();
      }
      return;
    }

    const hide = target.closest("[data-hide]");
    if (hide instanceof HTMLElement) {
      const panel = document.getElementById(hide.dataset.hide ?? "");
      if (panel instanceof HTMLElement) panel.hidden = true;
      return;
    }

    const action = target.closest("[data-json-action]");
    if (action instanceof HTMLElement) {
      const url = action.dataset.jsonAction;
      const method = action.dataset.jsonMethod ?? "POST";
      if (!url) return;
      let body = {};
      try {
        body = JSON.parse(action.dataset.jsonBody ?? "{}");
      } catch {
        setStatus("This action is misconfigured.", "error");
        return;
      }
      void request(url, method, body);
      return;
    }

    const deleteButton = target.closest("[data-delete-action]");
    if (
      deleteButton instanceof HTMLElement &&
      deleteDialog instanceof HTMLDialogElement
    ) {
      const expectedName = deleteButton.dataset.deleteName ?? "";
      deleteDialog.dataset.deleteAction = deleteButton.dataset.deleteAction ?? "";
      deleteDialog.dataset.deleteName = expectedName;
      const label = deleteDialog.querySelector("[data-delete-label]");
      const input = deleteDialog.querySelector("[data-delete-confirmation]");
      const submit = deleteDialog.querySelector("[data-delete-submit]");
      if (label instanceof HTMLElement) label.textContent = expectedName;
      if (input instanceof HTMLInputElement) input.value = "";
      if (submit instanceof HTMLButtonElement) submit.disabled = true;
      deleteDialog.showModal();
      if (input instanceof HTMLInputElement) input.focus();
    }
  });

  if (deleteDialog instanceof HTMLDialogElement) {
    const input = deleteDialog.querySelector("[data-delete-confirmation]");
    const submit = deleteDialog.querySelector("[data-delete-submit]");
    if (input instanceof HTMLInputElement && submit instanceof HTMLButtonElement) {
      input.addEventListener("input", () => {
        submit.disabled = input.value !== (deleteDialog.dataset.deleteName ?? "");
      });
    }
    deleteDialog.addEventListener("close", () => {
      if (deleteDialog.returnValue !== "confirm") return;
      const url = deleteDialog.dataset.deleteAction;
      if (url) void request(url, "DELETE", {});
    });
  }

  if (conflictDialog instanceof HTMLDialogElement) {
    conflictDialog
      .querySelector("[data-conflict-reload]")
      ?.addEventListener("click", () => window.location.reload());
    conflictDialog
      .querySelector("[data-conflict-dismiss]")
      ?.addEventListener("click", () => conflictDialog.close());
  }
})();
