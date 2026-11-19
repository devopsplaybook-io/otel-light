// Server-side export of the complete filtered result set.
//
// The server streams CSV or JSONL in keyset chunks, applies the same filters
// as the list and caps the result at ANALYTICS_EXPORT_MAX_ROWS (advertised in
// the X-Export-Max-Rows response header).
import axios from "axios";
import { SERVER_URL } from "./Config";
import { AuthService } from "./AuthService";

export type ServerExportSignal = "logs" | "traces";
export type ServerExportFormat = "csv" | "jsonl";

export function ServerExportContentType(format: ServerExportFormat): string {
  return format === "jsonl"
    ? "application/x-ndjson"
    : "text/csv;charset=utf-8";
}

export function ServerExportFilename(
  signalType: ServerExportSignal,
  format: ServerExportFormat,
): string {
  return `${signalType}-export.${format}`;
}

export function ServerExportUrl(
  signalType: ServerExportSignal,
  queryString: string,
  format: ServerExportFormat,
): string {
  const params = new URLSearchParams(queryString || "");
  params.set("format", format);
  return `${SERVER_URL}/analytics/${signalType}/export?${params.toString()}`;
}

export function ServerExportMaxRowsFromHeaders(
  headers: Record<string, unknown> | undefined,
): number | null {
  const raw = headers?.["x-export-max-rows"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function ServerExportDownload(
  signalType: ServerExportSignal,
  queryString: string,
  format: ServerExportFormat,
): Promise<{ maxRows: number | null }> {
  const response = await axios.get(
    ServerExportUrl(signalType, queryString, format),
    {
      ...AuthService.getAuthHeader(),
      responseType: "blob",
    },
  );
  const url = URL.createObjectURL(
    new Blob([response.data], { type: ServerExportContentType(format) }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = ServerExportFilename(signalType, format);
  anchor.click();
  URL.revokeObjectURL(url);
  return { maxRows: ServerExportMaxRowsFromHeaders(response.headers) };
}
