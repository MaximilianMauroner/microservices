(() => {
  "use strict";

  const root = document.querySelector("[data-ops-root]");
  if (!(root instanceof HTMLElement)) return;

  const status = document.querySelector("[data-mutation-status]");
  const conflictDialog = document.querySelector("[data-conflict-dialog]");
  const deleteDialog = document.querySelector("[data-delete-dialog]");
  const collectionRequests = new WeakMap();

  const setStatus = (message, kind = "pending") => {
    if (!(status instanceof HTMLElement)) return;
    status.textContent = message;
    status.className = `notice notice--${kind}`;
    status.hidden = false;
  };

  const currentRevision = () => root.dataset.revision ?? "";

  const request = async (url, method, body, source) => {
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
    if (payload && payload.reload === false) {
      if (typeof payload.revision === "string") {
        root.dataset.revision = payload.revision;
        const revision = document.querySelector("[data-current-revision]");
        if (revision instanceof HTMLElement) revision.textContent = payload.revision;
      }
      setStatus("Nothing changed.", "success");
      return;
    }
    if (source instanceof HTMLElement && source.dataset.moveName) {
      const direction = JSON.parse(source.dataset.jsonBody || "{}").direction;
      const current = Number(source.dataset.movePosition);
      const count = Number(source.dataset.moveCount);
      const next = direction === "up" ? current - 1 : current + 1;
      sessionStorage.setItem("ops:announcement", `Moved ${source.dataset.moveName} to position ${next} of ${count}`);
      const panel = source.closest("[data-editor-panel]");
      if (panel instanceof HTMLElement && panel.dataset.editorPanel) {
        sessionStorage.setItem("ops:selected", panel.dataset.editorPanel);
      }
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

  const linkValues = (editor) => {
    const links = [];
    const ids = new Set();
    const urls = new Set();
    for (const row of editor.querySelectorAll("[data-link-row]")) {
      const value = {};
      for (const field of row.querySelectorAll("[data-link-field]")) {
        if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) continue;
        value[field.dataset.linkField] = field.value.trim();
      }
      const id = value.id || "";
      const url = value.url || "";
      if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) {
        const input = row.querySelector('[data-link-field="id"]');
        if (input instanceof HTMLElement) input.focus();
        throw new Error(ids.has(id) ? "Link IDs must be unique." : "Each link needs a URL-safe ID.");
      }
      let parsed;
      try { parsed = new URL(url); } catch { parsed = null; }
      if (!parsed || !["http:", "https:"].includes(parsed.protocol) || urls.has(parsed.href)) {
        const input = row.querySelector('[data-link-field="url"]');
        if (input instanceof HTMLElement) input.focus();
        throw new Error(urls.has(parsed && parsed.href) ? "Link URLs must be unique." : "Each link URL must use HTTP or HTTPS.");
      }
      if (!value.label) {
        const input = row.querySelector('[data-link-field="label"]');
        if (input instanceof HTMLElement) input.focus();
        throw new Error("Each link needs a label.");
      }
      ids.add(id);
      urls.add(parsed.href);
      links.push({ id, label: value.label, url: parsed.href, access: value.access || "private" });
    }
    return links;
  };

  const syncLinks = (editor) => {
    const textarea = editor.querySelector('textarea[name="links"]');
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    textarea.value = JSON.stringify(linkValues(editor), null, 2);
  };

  const createLinkRow = (link = { id: "", label: "", url: "", access: "private" }) => {
    const row = element("div", undefined, "link-row");
    row.setAttribute("data-link-row", "");
    const fields = [
      ["id", "ID", "input"], ["label", "Label", "input"],
      ["url", "URL", "input"], ["access", "Access", "select"]
    ];
    for (const [key, labelText, kind] of fields) {
      const label = element("label", labelText + " ");
      const field = document.createElement(kind);
      field.setAttribute("data-link-field", key);
      if (field instanceof HTMLInputElement) {
        field.value = link[key] || "";
        field.required = true;
        if (key === "url") field.type = "url";
      } else {
        for (const value of ["public", "restricted", "private"]) {
          const option = element("option", value[0].toUpperCase() + value.slice(1));
          option.value = value;
          option.selected = value === link.access;
          field.append(option);
        }
      }
      label.append(field);
      row.append(label);
    }
    const remove = element("button", "Remove", "button");
    remove.type = "button";
    remove.setAttribute("data-link-remove", "");
    row.append(remove);
    return row;
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
    if (collectionRequests.has(section)) return;
    const endpoint = section.dataset.endpoint;
    const container = section.querySelector("[data-collection-items]");
    const loading = section.querySelector("[data-collection-loading]");
    const error = section.querySelector("[data-collection-error]");
    const errorMessage = section.querySelector("[data-collection-error-message]");
    const more = section.querySelector("[data-collection-more]");
    if (!endpoint || !(container instanceof HTMLElement)) return;
    const controller = new AbortController();
    collectionRequests.set(section, controller);
    const timeout = window.setTimeout(() => controller.abort("timeout"), 8000);
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
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error("Your Access session expired. Refresh the page to sign in again.");
      }
      if (!response.ok) {
        throw new Error(`Protected data could not be loaded (HTTP ${response.status}).`);
      }
      let payload;
      try { payload = await response.json(); } catch { throw new Error("The server returned malformed data. Try again."); }
      if (!payload || !Array.isArray(payload.items) || !(payload.nextCursor === null || typeof payload.nextCursor === "string" || payload.nextCursor === undefined)) {
        throw new Error("The server returned malformed data. Try again.");
      }
      const fragment = document.createDocumentFragment();
      for (const item of payload.items) {
        if (section.dataset.opsCollection === "history") {
          appendHistoryPartition(fragment, item);
        } else {
          appendAuditRecord(fragment, item);
        }
      }
      container.querySelector("[data-collection-empty]")?.remove();
      container.append(fragment);
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
          controller.signal.aborted
            ? "Loading timed out after 8 seconds. Check your connection and try again."
            : cause instanceof TypeError
              ? "Protected data could not be reached. Check your connection and try again."
              : cause instanceof Error ? cause.message : "Protected data could not be loaded.";
      }
      const retry = section.querySelector("[data-collection-retry]");
      if (retry instanceof HTMLButtonElement) retry.focus();
    } finally {
      window.clearTimeout(timeout);
      collectionRequests.delete(section);
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
      const editor = form.querySelector("[data-link-editor]");
      if (editor instanceof HTMLElement) syncLinks(editor);
      body = formBody(form);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Links are invalid. Correct them before saving.", "error");
      return;
    }
    const override = new FormData(form).get("_method");
    const method = typeof override === "string" ? override : form.method.toUpperCase();
    void request(form.action, method, body, form);
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

    const editorTarget = target.closest("[data-editor-target]");
    if (editorTarget instanceof HTMLElement) {
      selectEditor(editorTarget.dataset.editorTarget || "", true);
      return;
    }

    const linkAdd = target.closest("[data-link-add]");
    if (linkAdd instanceof HTMLElement) {
      const editor = linkAdd.closest("[data-link-editor]");
      const rows = editor && editor.querySelector("[data-link-rows]");
      if (editor instanceof HTMLElement && rows instanceof HTMLElement) {
        const row = createLinkRow();
        rows.append(row);
        row.querySelector("input")?.focus();
      }
      return;
    }

    const linkRemove = target.closest("[data-link-remove]");
    if (linkRemove instanceof HTMLElement) {
      const editor = linkRemove.closest("[data-link-editor]");
      linkRemove.closest("[data-link-row]")?.remove();
      if (editor instanceof HTMLElement) {
        try { syncLinks(editor); } catch { /* incomplete rows remain editable */ }
      }
      return;
    }

    const hide = target.closest("[data-hide]");
    if (hide instanceof HTMLElement) {
      const panel = document.getElementById(hide.dataset.hide ?? "");
      const firstRecord = document.querySelector(".record-button:not([hidden])");
      if (panel instanceof HTMLElement && firstRecord instanceof HTMLElement) {
        selectEditor(firstRecord.dataset.editorTarget || "", true);
      } else if (panel instanceof HTMLFormElement) {
        panel.reset();
        panel.querySelector("input, select, textarea")?.focus();
      }
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
      void request(url, method, body, action);
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
      if (url) void request(url, "DELETE", {}, deleteDialog);
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

  const selectEditor = (key, focus) => {
    let selected = null;
    for (const panel of document.querySelectorAll("[data-editor-panel]")) {
      if (!(panel instanceof HTMLElement)) continue;
      panel.hidden = panel.dataset.editorPanel !== key;
      if (!panel.hidden) selected = panel;
    }
    for (const button of document.querySelectorAll("[data-editor-target]")) {
      if (!(button instanceof HTMLElement)) continue;
      if (button.dataset.editorTarget === key) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    }
    if (selected instanceof HTMLElement) {
      sessionStorage.setItem("ops:selected", key);
      if (focus) selected.querySelector("input, select, textarea, button")?.focus();
    }
  };

  const filterRecords = () => {
    const search = document.querySelector("[data-record-search]:not([data-editor-target])");
    const kind = document.querySelector("[data-record-kind]:not([data-editor-target])");
    const statusFilter = document.querySelector("[data-record-status]:not([data-editor-target])");
    const query = search instanceof HTMLInputElement ? search.value.trim().toLowerCase() : "";
    const selectedKind = kind instanceof HTMLSelectElement ? kind.value : "all";
    const selectedStatus = statusFilter instanceof HTMLSelectElement ? statusFilter.value : "all";
    let visible = 0;
    for (const button of document.querySelectorAll(".record-button")) {
      if (!(button instanceof HTMLElement)) continue;
      const matches = (!query || (button.dataset.recordSearch || "").includes(query)) &&
        (selectedKind === "all" || button.dataset.recordKind === selectedKind) &&
        (selectedStatus === "all" || (button.dataset.recordStatus || "").split(" ").includes(selectedStatus));
      button.hidden = !matches;
      if (matches) visible += 1;
    }
    const empty = document.querySelector("[data-record-empty]");
    if (empty instanceof HTMLElement) empty.hidden = visible !== 0;
  };

  for (const control of document.querySelectorAll("[data-record-search], [data-record-kind], [data-record-status]")) {
    control.addEventListener("input", filterRecords);
    control.addEventListener("change", filterRecords);
  }
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches("[data-link-field]")) return;
    const editor = target.closest("[data-link-editor]");
    if (editor instanceof HTMLElement) {
      try { syncLinks(editor); } catch { /* validate on submit */ }
    }
  });

  for (const textarea of document.querySelectorAll('textarea[name="links"]')) {
    textarea.addEventListener("change", () => {
      if (!(textarea instanceof HTMLTextAreaElement)) return;
      const editor = textarea.closest("[data-link-editor]");
      const rows = editor && editor.querySelector("[data-link-rows]");
      if (!(editor instanceof HTMLElement) || !(rows instanceof HTMLElement)) return;
      try {
        const links = JSON.parse(textarea.value);
        if (!Array.isArray(links)) throw new Error();
        const fragment = document.createDocumentFragment();
        for (const link of links) fragment.append(createLinkRow(link));
        rows.replaceChildren(fragment);
        syncLinks(editor);
      } catch {
        setStatus("Advanced links JSON is invalid.", "error");
        textarea.focus();
      }
    });
  }

  const storedSelection = sessionStorage.getItem("ops:selected");
  const announcement = sessionStorage.getItem("ops:announcement");
  const defaultPanel = document.querySelector("[data-editor-panel]:not([hidden])");
  const storedPanelExists = [...document.querySelectorAll("[data-editor-panel]")].some((panel) =>
    panel instanceof HTMLElement && panel.dataset.editorPanel === storedSelection
  );
  selectEditor(storedPanelExists && storedSelection
    ? storedSelection
    : defaultPanel instanceof HTMLElement ? defaultPanel.dataset.editorPanel || "" : "", Boolean(announcement));
  if (announcement) {
    sessionStorage.removeItem("ops:announcement");
    setStatus(announcement, "success");
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
