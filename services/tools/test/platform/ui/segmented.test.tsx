// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Segmented } from "../../../platform/ui/components/segmented.js";

it("selects one option and supports arrow-key navigation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Example() {
    const [value, setValue] = useState<"day" | "week">("day");
    return <Segmented label="Period" value={value} onValue={setValue} options={[["day", "Day"], ["week", "Week"]]} />;
  }
  try {
    await act(async () => root.render(<Example />));
    const [day, week] = host.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    expect(day.getAttribute("aria-checked")).toBe("true");
    await act(async () => { day.focus(); day.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(week.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(week);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
