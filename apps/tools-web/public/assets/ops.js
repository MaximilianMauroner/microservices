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

  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (typeof text === "string") node.textContent = text;
    if (typeof className === "string") node.className = className;
    return node;
  };

  const appendTime = (parent, value, prefix = "") => {
    const time = element("time", `${prefix}${value}`);
    time.dateTime = value;
    parent.append(time);
  };

  const appendHistoryPartition = (container, partition) => {
    if (
      typeof partition !== "object" ||
      partition === null ||
      typeof partition.day !== "string" ||
      !Array.isArray(partition.observations) ||
      !Array.isArray(partition.incidents)
    ) {
      throw new Error("Invalid history response");
    }
    const article = element("article", undefined, "history-day");
    const heading = element("h3");
    appendTime(heading, partition.day);
    article.append(heading);
    const columns = element("div", undefined, "history-columns");

    const checks = element("section");
    checks.setAttribute("aria-label", `Checks for ${partition.day}`);
    checks.append(element("h4", "Checks"));
    if (partition.observations.length === 0) {
      checks.append(element("p", "No raw checks retained for this day.", "empty-row"));
    } else {
      const list = element("ul", undefined, "history-list");
      list.setAttribute("role", "list");
      for (const observation of partition.observations) {
        if (
          typeof observation !== "object" ||
          observation === null ||
          typeof observation.id !== "string" ||
          typeof observation.runId !== "string" ||
          (observation.monitorId !== null &&
            typeof observation.monitorId !== "string") ||
          typeof observation.checkedAt !== "string"
        ) {
          throw new Error("Invalid observation response");
        }
        const item = element("li");
        const identity = element("div");
        identity.append(
          element(
            "strong",
            observation.monitorId === null
              ? "Legacy monitor unknown"
              : observation.monitorId
          ),
          element("span", `Observation ${observation.id} · Run ${observation.runId}`)
        );
        const succeeded = observation.success === true;
        const state = element(
          "span",
          succeeded
            ? "Succeeded"
            : typeof observation.errorCode === "string"
              ? observation.errorCode
              : "Failed",
          `status ${succeeded ? "status--up" : "status--down"}`
        );
        const metrics = element(
          "span",
          `${Number(observation.latencyMs)} ms${
            typeof observation.statusCode === "number"
              ? ` · HTTP ${observation.statusCode}`
              : ""
          }`
        );
        const checkedAt = element("span");
        appendTime(checkedAt, observation.checkedAt);
        item.append(identity, state, metrics, checkedAt);
        list.append(item);
      }
      checks.append(list);
    }

    const incidents = element("section");
    incidents.setAttribute("aria-label", `Incidents for ${partition.day}`);
    incidents.append(element("h4", "Incidents"));
    if (partition.incidents.length === 0) {
      incidents.append(element("p", "No incidents recorded for this day.", "empty-row"));
    } else {
      const list = element("ul", undefined, "incident-list");
      list.setAttribute("role", "list");
      for (const incident of partition.incidents) {
        if (
          typeof incident !== "object" ||
          incident === null ||
          typeof incident.monitorId !== "string" ||
          typeof incident.startedAt !== "string"
        ) {
          throw new Error("Invalid incident response");
        }
        const item = element("li");
        item.append(
          element("strong", incident.monitorId),
          element(
            "span",
            incident.resolvedAt === null ? "Open incident" : "Resolved incident"
          )
        );
        appendTime(item, incident.startedAt, "Opened ");
        if (typeof incident.resolvedAt === "string") {
          appendTime(item, incident.resolvedAt, "Resolved ");
        }
        list.append(item);
      }
      incidents.append(list);
    }
    columns.append(checks, incidents);
    article.append(columns);
    container.append(article);
  };

  const appendAuditRecord = (container, record) => {
    if (
      typeof record !== "object" ||
      record === null ||
      typeof record.action !== "string" ||
      typeof record.actor !== "string" ||
      typeof record.occurredAt !== "string" ||
      typeof record.targetType !== "string" ||
      typeof record.catalogRevisionAfter !== "string"
    ) {
      throw new Error("Invalid audit response");
    }
    const item = element("li", undefined, "audit-record");
    const action = element("div");
    action.append(
      element("strong", record.action),
      element(
        "span",
        `${record.targetType}${
          typeof record.targetId === "string" ? ` · ${record.targetId}` : ""
        }`
      )
    );
    const actor = element("div");
    actor.append(element("span", record.actor));
    appendTime(actor, record.occurredAt);
    const revision = element("code", record.catalogRevisionAfter);
    revision.title = "Catalog revision";
    item.append(action, actor, revision);
    container.append(item);
  };

  const loadCollection = async (section) => {
    if (!(section instanceof HTMLElement)) return;
    const endpoint = section.dataset.endpoint;
    const container = section.querySelector("[data-collection-items]");
    const loading = section.querySelector("[data-collection-loading]");
    const error = section.querySelector("[data-collection-error]");
    const errorMessage = section.querySelector("[data-collection-error-message]");
    const more = section.querySelector("[data-collection-more]");
    if (!endpoint || !(container instanceof HTMLElement)) return;
    if (loading instanceof HTMLElement) loading.hidden = false;
    if (error instanceof HTMLElement) error.hidden = true;
    if (more instanceof HTMLButtonElement) more.disabled = true;
    section.setAttribute("aria-busy", "true");

    const cursor = section.dataset.nextCursor;
    const url = new URL(endpoint, window.location.origin);
    if (cursor) url.searchParams.set("cursor", cursor);
    try {
      const response = await fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.items)) {
        throw new Error(
          typeof payload.message === "string"
            ? payload.message
            : `Request failed (HTTP ${response.status})`
        );
      }
      container.querySelector("[data-collection-empty]")?.remove();
      for (const item of payload.items) {
        if (section.dataset.opsCollection === "history") {
          appendHistoryPartition(container, item);
        } else {
          appendAuditRecord(container, item);
        }
      }
      if (container.childElementCount === 0) {
        const emptyTag =
          section.dataset.opsCollection === "history" ? "p" : "li";
        container.append(
          element(
            emptyTag,
            section.dataset.opsCollection === "history"
              ? "No check or incident history is available yet."
              : "No catalog audit events are available yet.",
            "empty-row"
          )
        );
        container.lastElementChild?.setAttribute("data-collection-empty", "");
      }
      if (typeof payload.nextCursor === "string" && payload.nextCursor !== "") {
        section.dataset.nextCursor = payload.nextCursor;
        if (more instanceof HTMLButtonElement) more.hidden = false;
      } else {
        delete section.dataset.nextCursor;
        if (more instanceof HTMLButtonElement) more.hidden = true;
      }
    } catch (cause) {
      if (error instanceof HTMLElement) error.hidden = false;
      if (errorMessage instanceof HTMLElement) {
        errorMessage.textContent =
          cause instanceof Error ? cause.message : "Protected data could not be loaded.";
      }
    } finally {
      section.removeAttribute("aria-busy");
      if (loading instanceof HTMLElement) loading.hidden = true;
      if (more instanceof HTMLButtonElement) more.disabled = false;
    }
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
      deleteDialog.returnValue = "";
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

  for (const section of document.querySelectorAll("[data-ops-collection]")) {
    if (!(section instanceof HTMLElement)) continue;
    section
      .querySelector("[data-collection-retry]")
      ?.addEventListener("click", () => void loadCollection(section));
    section
      .querySelector("[data-collection-more]")
      ?.addEventListener("click", () => void loadCollection(section));
    if (section.querySelector("[data-collection-loading]:not([hidden])")) {
      void loadCollection(section);
    }
  }
})();
