import { toast } from "../src/components/ui/toast.js";

type ClipboardWriter = Pick<Clipboard, "writeText">;

export async function copyFeedbackText(
  text: string,
  successTitle: string,
  clipboard: ClipboardWriter | undefined = navigator.clipboard,
) {
  try {
    if (!clipboard) throw new Error("Clipboard API unavailable");
    await clipboard.writeText(text);
    toast.add({ title: successTitle, type: "success" });
    return true;
  } catch {
    toast.add({
      title: "Copy failed",
      description: "Clipboard access was denied. Copy the text manually.",
      type: "error",
    });
    return false;
  }
}
