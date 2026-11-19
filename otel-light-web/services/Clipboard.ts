/**
 * Copies text to the clipboard. `navigator.clipboard` is unavailable on
 * insecure (plain-HTTP) origins, which is a supported deployment scenario
 * for otel-light, so fall back to a temporary readonly textarea.
 */
export async function ClipboardWriteText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Clipboard copy failed");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}
