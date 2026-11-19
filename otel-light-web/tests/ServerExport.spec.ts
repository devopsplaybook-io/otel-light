import { afterEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();

vi.mock("axios", () => ({
  default: { get: (...args: unknown[]) => getMock(...args) },
}));

vi.mock("../services/AuthService", () => ({
  AuthService: {
    getAuthHeader: () => ({ headers: { Authorization: "Bearer test" } }),
  },
}));

import {
  ServerExportContentType,
  ServerExportDownload,
  ServerExportFilename,
  ServerExportMaxRowsFromHeaders,
  ServerExportUrl,
} from "../services/ServerExport";

describe("ServerExport helpers", () => {
  it("builds the export URL and keeps the filter query", () => {
    const url = ServerExportUrl(
      "logs",
      "keywords=boom&severity=ERROR",
      "jsonl",
    );
    expect(url).toBe(
      "/api/analytics/logs/export?keywords=boom&severity=ERROR&format=jsonl",
    );
  });

  it("overrides a stale format parameter", () => {
    const url = ServerExportUrl("traces", "format=csv&status=error", "jsonl");
    expect(url).toBe(
      "/api/analytics/traces/export?format=jsonl&status=error",
    );
  });

  it("names files and content types per format", () => {
    expect(ServerExportFilename("logs", "csv")).toBe("logs-export.csv");
    expect(ServerExportFilename("traces", "jsonl")).toBe(
      "traces-export.jsonl",
    );
    expect(ServerExportContentType("csv")).toMatch(/^text\/csv/);
    expect(ServerExportContentType("jsonl")).toBe("application/x-ndjson");
  });

  it("reads the advertised row cap from response headers", () => {
    expect(
      ServerExportMaxRowsFromHeaders({ "x-export-max-rows": "100000" }),
    ).toBe(100000);
    expect(
      ServerExportMaxRowsFromHeaders({ "x-export-max-rows": ["42"] }),
    ).toBe(42);
    expect(ServerExportMaxRowsFromHeaders({})).toBeNull();
    expect(
      ServerExportMaxRowsFromHeaders({ "x-export-max-rows": "nope" }),
    ).toBeNull();
  });
});

describe("ServerExportDownload", () => {
  afterEach(() => {
    getMock.mockReset();
    vi.restoreAllMocks();
  });

  it("requests the streamed export with auth and triggers a download", async () => {
    getMock.mockResolvedValue({
      data: "time,severity\r\n",
      headers: { "x-export-max-rows": "100000" },
    });
    const createObjectURL = vi.fn(() => "blob:export");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const result = await ServerExportDownload("logs", "keywords=a", "csv");

    expect(getMock).toHaveBeenCalledWith(
      "/api/analytics/logs/export?keywords=a&format=csv",
      expect.objectContaining({
        headers: { Authorization: "Bearer test" },
        responseType: "blob",
      }),
    );
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
    expect(click).toHaveBeenCalled();
    expect(result.maxRows).toBe(100000);
  });
});
