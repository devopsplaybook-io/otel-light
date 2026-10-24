import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ErrorAlertText,
  EventBus,
  EventTypes,
  handleError,
} from "../services/EventBus";

afterEach(() => {
  EventBus.all.delete(EventTypes.ALERT_MESSAGE);
});

describe("ErrorAlertText", () => {
  it("prefers response.data.error", () => {
    expect(
      ErrorAlertText({ response: { data: { error: "Access Denied" } } }),
    ).toBe("Access Denied");
  });

  it("falls back to response.data.message", () => {
    expect(
      ErrorAlertText({ response: { data: { message: "not found" } } }),
    ).toBe("not found");
  });

  it("serializes other response payloads instead of [object Object]", () => {
    const text = ErrorAlertText({
      response: { status: 400, data: { code: "Invalid" } },
    });
    expect(text).toBe('{"code":"Invalid"}');
    expect(text).not.toContain("[object Object]");
  });

  it("falls back to the HTTP status and status text", () => {
    expect(
      ErrorAlertText({
        response: { status: 503, statusText: "Service Unavailable", data: {} },
      }),
    ).toBe("HTTP 503 Service Unavailable");
  });

  it("falls back to error.message", () => {
    expect(ErrorAlertText(new Error("network down"))).toBe("network down");
  });

  it("never returns [object Object] for an unknown error", () => {
    expect(ErrorAlertText({ some: "object" })).toBe("Unknown error");
  });
});

describe("handleError", () => {
  it("emits a string alert on the EventBus", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const received: any[] = [];
    EventBus.on(EventTypes.ALERT_MESSAGE, (message) => received.push(message));

    handleError({ response: { status: 503, data: {} } });

    expect(consoleSpy).toHaveBeenCalled();
    expect(received).toEqual([{ type: "error", text: "HTTP 503" }]);
    expect(typeof received[0].text).toBe("string");
    consoleSpy.mockRestore();
  });
});
