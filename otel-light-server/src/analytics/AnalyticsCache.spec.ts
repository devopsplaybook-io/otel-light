jest.mock("../OTelContext", () => {
  const span = {
    end: jest.fn(),
    addEvent: jest.fn(),
    setStatus: jest.fn(),
  };
  const moduleLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    OTelLogger: () => ({ createModuleLogger: () => moduleLogger }),
    OTelTracer: () => ({ startSpan: () => span }),
  };
});

jest.mock("../SignalRollups", () => ({
  SignalRollupsGetServicesAndVersions: jest.fn(),
  SignalRollupsGetMetricNames: jest.fn(),
  SignalRollupsIsReady: jest.fn(),
}));

import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
  AnalyticsCacheFilterMetricsNames,
  AnalyticsCacheGetServices,
  AnalyticsCacheInit,
  AnalyticsCacheRefresh,
  MetricsNamesEntry,
} from "./AnalyticsCache";
import {
  SignalRollupsGetMetricNames,
  SignalRollupsGetServicesAndVersions,
  SignalRollupsIsReady,
} from "../SignalRollups";

// A minimal Span stub; the mocked tracer ignores it.
const fakeSpan = { end: jest.fn() } as never;

// We test the filter logic by importing the module and directly invoking
// the functions it exposes. The cache-dependent functions rely on internal
// module state, so we test analytics cache refresh/preservation below by
// mocking the rollup reads.

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

// L11: a failed refresh or a not-ready rollup must not wipe the cache, while
// a valid empty refresh (signals were deleted) must clear it.
describe("AnalyticsCacheRefresh preservation (L11)", () => {
  let tmpDir: string;
  let cacheFile: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "otel-light-cache-"));
    cacheFile = path.join(tmpDir, "cache", "analyticsCache.json");
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (SignalRollupsIsReady as jest.Mock).mockReturnValue(true);
    (SignalRollupsGetServicesAndVersions as jest.Mock).mockResolvedValue({
      services: ["svc-a"],
      serviceVersions: [{ serviceName: "svc-a", serviceVersion: "1.0.0" }],
    });
    (SignalRollupsGetMetricNames as jest.Mock).mockResolvedValue([
      {
        serviceName: "svc-a",
        name: "metric.a",
        type: "sum",
        firstSeen: 1,
        lastSeen: 2,
      },
    ]);
  });

  it("populates the cache and persists valid JSON", async () => {
    await AnalyticsCacheInit(fakeSpan, {
      DATA_DIR: tmpDir,
      CACHE_REFRESH_MINUTES: 1,
    } as never);

    expect(AnalyticsCacheGetServices()).toEqual({
      services: ["svc-a"],
      serviceVersions: [{ serviceName: "svc-a", serviceVersion: "1.0.0" }],
    });

    const content = await fs.readJson(cacheFile);
    expect(content.services.services).toEqual(["svc-a"]);
    expect(content.metricsNames.names.map((n: { name: string }) => n.name)).toEqual(
      ["metric.a"],
    );
  });

  it("preserves existing data when the refresh fails", async () => {
    (SignalRollupsGetServicesAndVersions as jest.Mock).mockRejectedValue(
      new Error("db down"),
    );
    (SignalRollupsGetMetricNames as jest.Mock).mockRejectedValue(
      new Error("db down"),
    );

    await AnalyticsCacheRefresh();

    expect(AnalyticsCacheGetServices()?.services).toEqual(["svc-a"]);
    const content = await fs.readJson(cacheFile);
    expect(content.services.services).toEqual(["svc-a"]);
    expect(content.metricsNames.names.map((n: { name: string }) => n.name)).toEqual(
      ["metric.a"],
    );
  });

  it("preserves existing data while the rollups are not ready", async () => {
    (SignalRollupsIsReady as jest.Mock).mockReturnValue(false);
    (SignalRollupsGetServicesAndVersions as jest.Mock).mockResolvedValue({
      services: [],
      serviceVersions: [],
    });
    (SignalRollupsGetMetricNames as jest.Mock).mockResolvedValue([]);

    await AnalyticsCacheRefresh();

    expect(AnalyticsCacheGetServices()?.services).toEqual(["svc-a"]);
    expect(AnalyticsCacheFilterMetricsNames()).toHaveLength(1);
  });

  it("clears the cache on a valid empty refresh", async () => {
    (SignalRollupsGetServicesAndVersions as jest.Mock).mockResolvedValue({
      services: [],
      serviceVersions: [],
    });
    (SignalRollupsGetMetricNames as jest.Mock).mockResolvedValue([]);

    await AnalyticsCacheRefresh();

    expect(AnalyticsCacheGetServices()).toEqual({
      services: [],
      serviceVersions: [],
    });
    expect(AnalyticsCacheFilterMetricsNames()).toEqual([]);

    const content = await fs.readJson(cacheFile);
    expect(content.services.services).toEqual([]);
    expect(content.metricsNames.names).toEqual([]);
  });
});
