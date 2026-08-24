import { afterEach, describe, expect, it, vi } from "vitest";
import { copyFeedbackText } from "../feedback/clipboard.js";
import { toast } from "../src/components/ui/toast.js";

describe("feedback clipboard actions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a success toast after copying", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const add = vi.spyOn(toast, "add").mockReturnValue("toast-id");

    await expect(copyFeedbackText("schema", "JSON copied", { writeText })).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("schema");
    expect(add).toHaveBeenCalledWith({ title: "JSON copied", type: "success" });
  });

  it("shows an error toast when clipboard access fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const add = vi.spyOn(toast, "add").mockReturnValue("toast-id");

    await expect(copyFeedbackText("schema", "JSON copied", { writeText })).resolves.toBe(false);

    expect(add).toHaveBeenCalledWith({
      title: "Copy failed",
      description: "Clipboard access was denied. Copy the text manually.",
      type: "error",
    });
  });
});
