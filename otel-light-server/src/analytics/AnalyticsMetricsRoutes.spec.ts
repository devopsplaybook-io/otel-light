import Fastify from "fastify";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock("../utils-std-ts/DbUtilsNoTelemetry", () => ({
  DbUtilsNoTelemetryQuerySQL: jest.fn(),
}));

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  AuthGetUserSession: jest.fn(),
  AuthHasScope: jest.fn(),
}));

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

jest.mock("./AnalyticsUtils", () => ({
  ...jest.requireActual("./AnalyticsUtils"),
  AnalyticsUtilsCompressJson: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import {
  AuthGetUserSession,
  AuthHasScope,
} from "@devopsplaybook.io/common-utils";
import { AnalyticsUtilsCompressJson } from "./AnalyticsUtils";
import { AnalyticsMetricsRoutes } from "./AnalyticsMetricsRoutes";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AnalyticsMetricsRoutes GET /analytics/metrics", () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(new AnalyticsMetricsRoutes().getRoutes, {
      prefix: "/analytics/metrics",
    });
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: true,
    });
    (AuthHasScope as jest.Mock).mockResolvedValue(undefined);
    (DbUtilsNoTelemetryQuerySQL as jest.Mock).mockResolvedValue([]);
    (AnalyticsUtilsCompressJson as jest.Mock).mockResolvedValue(
      "compressed-data",
    );
  });

  // --- Auth ---
  it("returns 403 when not authenticated", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });

    const res = await fastify.inject({
      method: "GET",
      url: "/analytics/metrics",
    });

    expect(res.statusCode).toBe(403);
    expect(DbUtilsNoTelemetryQuerySQL).not.toHaveBeenCalled();
  });

  // --- Pagination: beforeTime ---
  it("adds AND time < when beforeTime param is provided", async () => {
    await fastify.inject({
      method: "GET",
      url: "/analytics/metrics?name=http.requests&serviceName=my-svc&beforeTime=5000000",
    });

    expect(DbUtilsNoTelemetryQuerySQL).toHaveBeenCalledTimes(1);
    const [sql, params]: [string, unknown[]] = (
      DbUtilsNoTelemetryQuerySQL as jest.Mock
    ).mock.calls[0];

    expect(sql).toContain("AND time <");
    expect(params).toContain("5000000");
  });

  it("omits AND time < when beforeTime param is absent", async () => {
    await fastify.inject({
      method: "GET",
      url: "/analytics/metrics?name=http.requests&serviceName=my-svc",
    });

    const [sql]: [string] = (DbUtilsNoTelemetryQuerySQL as jest.Mock).mock
      .calls[0];

    expect(sql).not.toContain("AND time <");
  });

  it("preserves beforeTime in sqlParams when combined with other filters", async () => {
    await fastify.inject({
      method: "GET",
      url: "/analytics/metrics?name=latency&serviceName=api&from=1000000&to=9999999&beforeTime=5000000",
    });

    const [sql, params]: [string, unknown[]] = (
      DbUtilsNoTelemetryQuerySQL as jest.Mock
    ).mock.calls[0];

    expect(sql).toContain("AND time <");
    expect(params).toContain("5000000");
    expect(params).toContain("1000000");
    expect(params).toContain("9999999");
  });

  // --- Pagination: limit ---
  it("uses provided limit in SQL instead of default", async () => {
    await fastify.inject({
      method: "GET",
      url: "/analytics/metrics?name=http.requests&limit=250",
    });

    const [sql]: [string] = (DbUtilsNoTelemetryQuerySQL as jest.Mock).mock
      .calls[0];

    expect(sql).toContain("LIMIT 250");
  });

  it("uses AnalyticsUtilsResultLimitMetrics default when limit param omitted", async () => {
    const { AnalyticsUtilsResultLimitMetrics } =
      await import("./AnalyticsUtils");

    await fastify.inject({
      method: "GET",
      url: "/analytics/metrics?name=http.requests",
    });

    const [sql]: [string] = (DbUtilsNoTelemetryQuerySQL as jest.Mock).mock
      .calls[0];

    expect(sql).toContain(`LIMIT ${AnalyticsUtilsResultLimitMetrics}`);
  });

  // --- Combined: beforeTime + limit ---
  it("handles beforeTime and limit together correctly", async () => {
    await fastify.inject({
      method: "GET",
      url: "/analytics/metrics?name=http.requests&serviceName=my-svc&beforeTime=9999999&limit=200",
    });

    const [sql, params]: [string, unknown[]] = (
      DbUtilsNoTelemetryQuerySQL as jest.Mock
    ).mock.calls[0];

    expect(sql).toContain("AND time <");
    expect(sql).toContain("LIMIT 200");
    expect(params).toContain("9999999");
  });

  // --- Server-side sampling: maxPoints ---
  it("runs a COUNT query first when maxPoints is provided", async () => {
    (DbUtilsNoTelemetryQuerySQL as jest.Mock)
      .mockResolvedValueOnce([{ total: 100 }])
      .mockResolvedValueOnce([]);

    await fastify.inject({
      method: "GET",
      url: "/analytics/metrics?name=http.requests&serviceName=my-svc&maxPoints=500",
    });

    expect(DbUtilsNoTelemetryQuerySQL).toHaveBeenCalledTimes(2);
    const [countSql]: [string] = (DbUtilsNoTelemetryQuerySQL as jest.Mock).mock
      .calls[0];
    expect(countSql).toContain("COUNT(*)");
  });

  it("uses the plain query when total count fits within maxPoints", async () => {
    (DbUtilsNoTelemetryQuerySQL as jest.Mock)
      .mockResolvedValueOnce([{ total: 100 }])
      .mockResolvedValueOnce([]);

    await fastify.inject({
      method: "GET",
      url: "/analytics/metrics?name=http.requests&serviceName=my-svc&maxPoints=500",
    });

    const [sql]: [string] = (DbUtilsNoTelemetryQuerySQL as jest.Mock).mock
      .calls[1];
    expect(sql).not.toContain("ROW_NUMBER");
    expect(sql).toContain("LIMIT 500");
  });

  it("samples with ROW_NUMBER when total count exceeds maxPoints", async () => {
    (DbUtilsNoTelemetryQuerySQL as jest.Mock)
      .mockResolvedValueOnce([{ total: 10000 }])
      .mockResolvedValueOnce([]);

    await fastify.inject({
      method: "GET",
      url: "/analytics/metrics?name=http.requests&serviceName=my-svc&maxPoints=500",
    });

    const [sql]: [string] = (DbUtilsNoTelemetryQuerySQL as jest.Mock).mock
      .calls[1];
    expect(sql).toContain("ROW_NUMBER()");
    // step = ceil(10000 / 500) = 20
    expect(sql).toContain("(rn % 20) = 1");
    expect(sql).toContain("LIMIT 500");
  });

  it("clamps maxPoints to AnalyticsUtilsResultLimitMetrics", async () => {
    const { AnalyticsUtilsResultLimitMetrics } =
      await import("./AnalyticsUtils");
    (DbUtilsNoTelemetryQuerySQL as jest.Mock)
      .mockResolvedValueOnce([{ total: 10 }])
      .mockResolvedValueOnce([]);

    await fastify.inject({
      method: "GET",
      url: "/analytics/metrics?name=http.requests&maxPoints=99999999",
    });

    const [sql]: [string] = (DbUtilsNoTelemetryQuerySQL as jest.Mock).mock
      .calls[1];
    expect(sql).toContain(`LIMIT ${AnalyticsUtilsResultLimitMetrics}`);
  });

  it("ignores invalid maxPoints values", async () => {
    await fastify.inject({
      method: "GET",
      url: "/analytics/metrics?name=http.requests&maxPoints=abc",
    });

    expect(DbUtilsNoTelemetryQuerySQL).toHaveBeenCalledTimes(1);
    const [sql]: [string] = (DbUtilsNoTelemetryQuerySQL as jest.Mock).mock
      .calls[0];
    expect(sql).not.toContain("COUNT(*)");
  });

  // --- Success ---
  it("returns 200 with compressed metrics on success", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/analytics/metrics?name=http.requests",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("compressed", true);
    expect(body).toHaveProperty("metrics");
  });
});
