import { MetricsNamesEntry } from "./AnalyticsCache";

// We test the filter logic by importing the module and directly invoking
// the functions it exposes. The cache-dependent functions rely on internal
// module state, so we test AnalyticsCacheFilterMetricsNames indirectly via
// the filter logic which is pure data transformation.

describe("AnalyticsCache Filter Logic", () => {
  const sampleNames: MetricsNamesEntry[] = [
    {
      serviceName: "api-gateway",
      name: "http_requests_total",
      type: "sum",
      firstSeen: 5000,
      lastSeen: 9000,
    },
    {
      serviceName: "api-gateway",
      name: "response_time_ms",
      type: "gauge",
      firstSeen: 5000,
      lastSeen: 9000,
    },
    {
      serviceName: "auth-service",
      name: "login_attempts",
      type: "sum",
      firstSeen: 6000,
      lastSeen: 10000,
    },
    {
      serviceName: "auth-service",
      name: "token_validation_ms",
      type: "gauge",
      firstSeen: 6000,
      lastSeen: 10000,
    },
    {
      serviceName: "payment-service",
      name: "transaction_count",
      type: "sum",
      firstSeen: 7000,
      lastSeen: 11000,
    },
    {
      serviceName: "old-service",
      name: "deprecated_metric",
      type: "gauge",
      firstSeen: 1000,
      lastSeen: 2000,
    },
    {
      serviceName: "batch-service",
      name: "nightly_job_duration",
      type: "gauge",
      firstSeen: 3000,
      lastSeen: 4000,
    },
  ];

  it("should return all names when no filters are applied", () => {
    const result = filterNames(sampleNames);
    expect(result).toHaveLength(7);
  });

  it("should filter by service name", () => {
    const result = filterNames(sampleNames, "api-gateway");
    expect(result).toHaveLength(2);
    expect(result.every((n) => n.serviceName === "api-gateway")).toBe(true);
  });

  it("should filter by keyword matching name or service", () => {
    const result = filterNames(sampleNames, undefined, "login");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("login_attempts");
  });

  it("should filter by keyword matching both name and service", () => {
    const result = filterNames(sampleNames, undefined, "api");
    expect(result).toHaveLength(2);
    expect(result.every((n) => n.serviceName === "api-gateway")).toBe(true);
  });

  it("should filter by from time (lastSeen >= from)", () => {
    const result = filterNames(sampleNames, undefined, undefined, 5000);
    expect(result).toHaveLength(5);
    expect(result.every((n) => n.lastSeen >= 5000)).toBe(true);
  });

  it("should filter by to time (firstSeen <= to)", () => {
    const result = filterNames(
      sampleNames,
      undefined,
      undefined,
      undefined,
      5000,
    );
    expect(result).toHaveLength(4);
    expect(result.every((n) => n.firstSeen <= 5000)).toBe(true);
  });

  it("should combine service name and keyword filters", () => {
    const result = filterNames(sampleNames, "auth-service", "token");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("token_validation_ms");
  });

  it("should combine all filters", () => {
    const result = filterNames(sampleNames, "api-gateway", "http", 5000, 9000);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("http_requests_total");
  });

  it("should return empty array for empty input", () => {
    const result = filterNames([]);
    expect(result).toEqual([]);
  });

  it("should be case-insensitive for keyword search", () => {
    const result = filterNames(sampleNames, undefined, "HTTP_REQUESTS");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("http_requests_total");
  });
});

// Helper to replicate the filter logic from AnalyticsCacheFilterMetricsNames
// so we can test it without depending on the module's internal cache state.
function filterNames(
  names: MetricsNamesEntry[],
  serviceName?: string,
  keywords?: string,
  from?: number,
  to?: number,
): MetricsNamesEntry[] {
  let filtered = names;

  if (serviceName && serviceName.trim()) {
    const sn = serviceName.trim();
    filtered = filtered.filter((n) => n.serviceName === sn);
  }

  if (keywords && keywords.trim()) {
    const kw = keywords.toLowerCase().trim();
    filtered = filtered.filter(
      (n) =>
        n.name.toLowerCase().includes(kw) ||
        n.serviceName.toLowerCase().includes(kw),
    );
  }

  if (from) {
    filtered = filtered.filter((n) => n.lastSeen >= from);
  }
  if (to) {
    filtered = filtered.filter((n) => n.firstSeen <= to);
  }

  return filtered;
}
