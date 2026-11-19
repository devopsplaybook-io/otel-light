import { afterEach, describe, expect, it, vi } from "vitest";
import { ClipboardWriteText } from "../services/Clipboard";

const originalExecCommand = document.execCommand;

function setClipboard(value: any) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value,
  });
}

describe("ClipboardWriteText", () => {
  afterEach(() => {
    setClipboard(undefined);
    document.execCommand = originalExecCommand;
    vi.restoreAllMocks();
  });

  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    await ClipboardWriteText("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to a temporary textarea when the Clipboard API is missing", async () => {
    setClipboard(undefined);
    let copiedText = "";
    const execCommand = vi.fn(() => {
      copiedText = (document.querySelector("textarea") as HTMLTextAreaElement)
        .value;
      return true;
    });
    document.execCommand = execCommand as any;

    await ClipboardWriteText("filtered view");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copiedText).toBe("filtered view");
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("rejects when the fallback copy returns false", async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn(() => false) as any;

    await expect(ClipboardWriteText("nope")).rejects.toThrow(
      "Clipboard copy failed",
    );
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });
});
