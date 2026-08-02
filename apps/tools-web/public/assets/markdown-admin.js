(() => {
  "use strict";

  const root = document.querySelector("[data-markdown-admin]");
  if (!(root instanceof HTMLElement)) return;

  const list = root.querySelector("[data-document-list]");
  const search = root.querySelector("[data-document-search]");
  const checkpoints = root.querySelector("[data-document-checkpoints]");
  const expiry = root.querySelector("[data-document-expiry]");
  const sort = root.querySelector("[data-document-sort]");
  const count = root.querySelector("[data-document-count]");
  const empty = root.querySelector("[data-document-empty]");
  const rows = Array.from(root.querySelectorAll("[data-document-row]"));

  if (
    !(list instanceof HTMLElement) ||
    !(search instanceof HTMLInputElement) ||
    !(checkpoints instanceof HTMLSelectElement) ||
    !(expiry instanceof HTMLSelectElement) ||
    !(sort instanceof HTMLSelectElement)
  ) return;

  const numberValue = (row, key) => Number(row.dataset[key] ?? 0);
  const now = Number(root.dataset.generatedAt ?? Date.now());

  const compareRows = (left, right) => {
    switch (sort.value) {
      case "expiry-asc":
        return numberValue(left, "expires") - numberValue(right, "expires");
      case "created-desc":
        return numberValue(right, "created") - numberValue(left, "created");
      case "name-asc":
        return (left.dataset.filename ?? "").localeCompare(right.dataset.filename ?? "");
      default:
        return numberValue(right, "updated") - numberValue(left, "updated");
    }
  };

  const matchesFilters = (row) => {
    const query = search.value.trim().toLocaleLowerCase();
    const checkpointCount = numberValue(row, "checkpoints");
    const expiresIn = numberValue(row, "expires") - now;
    const expiryHours = expiry.value === "all" ? null : Number(expiry.value);
    return (
      (query === "" || (row.dataset.filename ?? "").includes(query)) &&
      (checkpoints.value === "all" ||
        (checkpoints.value === "with" ? checkpointCount > 0 : checkpointCount === 0)) &&
      (expiryHours === null || expiresIn <= expiryHours * 60 * 60 * 1000)
    );
  };

  const update = () => {
    const sortedRows = [...rows].sort(compareRows);
    let visible = 0;
    for (const row of sortedRows) {
      const matches = matchesFilters(row);
      row.hidden = !matches;
      if (matches) visible += 1;
      list.append(row);
    }
    if (count instanceof HTMLElement) {
      count.textContent = visible === rows.length
        ? `${visible} ${visible === 1 ? "document" : "documents"}`
        : `${visible} of ${rows.length} documents`;
    }
    if (empty instanceof HTMLElement) empty.hidden = visible !== 0;
  };

  for (const control of [search, checkpoints, expiry, sort]) {
    control.addEventListener(control === search ? "input" : "change", update);
  }

  for (const button of root.querySelectorAll("[data-copy-link]")) {
    if (!(button instanceof HTMLButtonElement)) continue;
    const originalLabel = button.textContent ?? "Copy link";
    button.addEventListener("click", async () => {
      const link = button.dataset.copyLink;
      if (!link) return;
      try {
        await navigator.clipboard.writeText(link);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Copy failed";
      }
      window.setTimeout(() => {
        button.textContent = originalLabel;
      }, 1800);
    });
  }
})();
