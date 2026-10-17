// Export helpers for shareable evidence: pretty-printed trace JSON bundles
// and RFC-4180 CSV of the filtered log records. File download is a thin DOM
// wrapper around Blob + temporary anchor click.

function CsvEscapeField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function ExportLogsCsv(logs: any[]): string {
  const header =
    "time,severity,serviceName,serviceVersion,traceId,spanId,logText";
  const lines = (logs || []).map((log) =>
    [
      log.time == null ? "" : new Date(log.time / 1_000_000).toISOString(),
      log.severity || "",
      log.serviceName || "",
      log.serviceVersion || "",
      log.traceId || "",
      log.spanId || "",
      log.logText || "",
    ]
      .map(CsvEscapeField)
      .join(",")
  );
  return [header, ...lines].join("\r\n");
}

export function ExportTraceJson(
  trace: any,
  traceSpans: any[],
  traceLogs: any[]
): string {
  return JSON.stringify(
    {
      trace,
      spans: traceSpans || [],
      logs: traceLogs || [],
    },
    null,
    2
  );
}

export function ExportDownloadFile(
  filename: string,
  content: string,
  mimeType: string
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
