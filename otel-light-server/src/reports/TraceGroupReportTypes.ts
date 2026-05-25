// ── Shared Types for Trace Group Reports ──────────────────────────────────────

export interface TraceTimeSeriesPoint {
  bucket: number;
  value: number;
}

export interface TraceGroupSeries {
  serviceName: string;
  name: string;
  dataPoints: TraceTimeSeriesPoint[];
}

export interface TraceGroupReport {
  generatedAt: string;
  periodDays: number;
  topN: number;
  bucketNs: number;
  series: TraceGroupSeries[];
}
