// H3 regression: stats, services, reports and recommendation routes must
// enforce authentication, signal scopes and admin rights. AuthHasScope /
// AuthMustBeAdmin deny by sending 403 and throwing (common-utils behavior);
// the mocks below reproduce that contract.

import Fastify from "fastify";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  AuthGetUserSession: jest.fn(),
  AuthHasScope: jest.fn(),
  AuthMustBeAdmin: jest.fn(),
}));

jest.mock("./utils-std-ts/DbUtilsNoTelemetry", () => ({
  DbUtilsNoTelemetryQuerySQL: jest.fn(),
}));

jest.mock("./utils-std-ts/DbUtils", () => ({
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

jest.mock("./analytics/AnalyticsCache", () => ({
  AnalyticsCacheGetServices: jest.fn(),
}));

jest.mock("./reports/LongestTracesReport", () => ({
  LongestTracesReportGetCached: jest.fn(),
  LongestTracesReportGenerate: jest.fn(),
}));

jest.mock("./reports/MostCalledTracesReport", () => ({
  MostCalledTracesReportGetCached: jest.fn(),
  MostCalledTracesReportGenerate: jest.fn(),
}));

jest.mock("./reports/Recommendation", () => ({
  RecommendationGetCached: jest.fn(),
  RecommendationGenerate: jest.fn(),
}));

import {
  AuthGetUserSession,
  AuthHasScope,
  AuthMustBeAdmin,
} from "@devopsplaybook.io/common-utils";
import { DbUtilsNoTelemetryQuerySQL } from "./utils-std-ts/DbUtilsNoTelemetry";
import { AnalyticsCacheGetServices } from "./analytics/AnalyticsCache";
import {
  LongestTracesReportGetCached,
  LongestTracesReportGenerate,
} from "./reports/LongestTracesReport";
import {
  MostCalledTracesReportGetCached,
  MostCalledTracesReportGenerate,
} from "./reports/MostCalledTracesReport";
import { RecommendationGetCached } from "./reports/Recommendation";
import { AnalyticsServicesRoutes } from "./analytics/AnalyticsServicesRoutes";
import { AnalyticsStatsRoutes } from "./analytics/AnalyticsStatsRoutes";
import { ReportsRoutes } from "./reports/ReportsRoutes";
import { RecommendationRoutes } from "./reports/RecommendationRoutes";

const deny = (mock: jest.Mock) =>
  mock.mockImplementation(
    async (
      _req: unknown,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res: any,
    ) => {
      res.status(403).send({ error: "Access Denied" });
      throw new Error("Access Denied");
    },
  );

describe("Scope enforcement (H3)", () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(new AnalyticsStatsRoutes().getRoutes, {
      prefix: "/api/analytics",
    });
    await fastify.register(new AnalyticsServicesRoutes().getRoutes, {
      prefix: "/api/analytics/services",
    });
    await fastify.register(new ReportsRoutes().getRoutes, { prefix: "/api" });
    await fastify.register(new RecommendationRoutes().getRoutes, {
      prefix: "/api/recommendation",
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
      role: "user",
      scopes: ["traces", "metrics", "logs"],
    });
    (AuthHasScope as jest.Mock).mockResolvedValue(undefined);
    (AuthMustBeAdmin as jest.Mock).mockResolvedValue(undefined);
    (DbUtilsNoTelemetryQuerySQL as jest.Mock).mockResolvedValue([]);
    (AnalyticsCacheGetServices as jest.Mock).mockReturnValue({
      services: ["svc-a"],
      serviceVersions: [{ serviceName: "svc-a", serviceVersion: "1.0" }],
    });
    (LongestTracesReportGetCached as jest.Mock).mockResolvedValue(null);
    (MostCalledTracesReportGetCached as jest.Mock).mockResolvedValue(null);
    (RecommendationGetCached as jest.Mock).mockResolvedValue(null);
  });

  const GET_ENDPOINTS = [
    "/api/analytics/logs/stats",
    "/api/analytics/traces/stats",
    "/api/analytics/services",
    "/api/reports/longest-traces",
    "/api/reports/most-called-traces",
    "/api/recommendation",
  ];

  it.each(GET_ENDPOINTS)("returns 403 when not authenticated: %s", async (url) => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await fastify.inject({ method: "GET", url });
    expect(res.statusCode).toBe(403);
  });

  it.each([
    ["/api/analytics/logs/stats", "logs"],
    ["/api/analytics/traces/stats", "traces"],
    ["/api/reports/longest-traces", "traces"],
    ["/api/reports/most-called-traces", "traces"],
    ["/api/recommendation", "traces"],
  ])(
    "returns 403 and asks for the %s scope on %s when it is denied",
    async (url, scope) => {
      deny(AuthHasScope as jest.Mock);
      const res = await fastify.inject({ method: "GET", url });
      expect(res.statusCode).toBe(403);
      expect(AuthHasScope).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        scope,
      );
    },
  );

  it.each([
    ["/api/analytics/logs/stats"],
    ["/api/analytics/traces/stats"],
    ["/api/reports/longest-traces"],
    ["/api/reports/most-called-traces"],
    ["/api/recommendation"],
  ])("passes through when the scope is granted: %s", async (url) => {
    const res = await fastify.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
  });

  it("grants the service list to any signal scope but 403s without one", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: true,
      role: "user",
      scopes: [],
    });
    const denied = await fastify.inject({
      method: "GET",
      url: "/api/analytics/services",
    });
    expect(denied.statusCode).toBe(403);

    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: true,
      role: "user",
      scopes: ["metrics"],
    });
    const allowed = await fastify.inject({
      method: "GET",
      url: "/api/analytics/services",
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().services).toEqual(["svc-a"]);
  });

  it("grants the service list to admins", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: true,
      role: "admin",
      scopes: [],
    });
    const res = await fastify.inject({
      method: "GET",
      url: "/api/analytics/services",
    });
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ["/api/reports/longest-traces/regenerate", LongestTracesReportGenerate],
    ["/api/reports/most-called-traces/regenerate", MostCalledTracesReportGenerate],
  ])(
    "returns 403 without admin rights on POST %s",
    async (url, generateMock) => {
      deny(AuthMustBeAdmin as jest.Mock);
      const res = await fastify.inject({ method: "POST", url });
      expect(res.statusCode).toBe(403);
      expect(generateMock).not.toHaveBeenCalled();
    },
  );

  it("returns 403 without admin rights on POST /api/recommendation/regenerate", async () => {
    deny(AuthMustBeAdmin as jest.Mock);
    const res = await fastify.inject({
      method: "POST",
      url: "/api/recommendation/regenerate",
    });
    expect(res.statusCode).toBe(403);
  });

  it("regenerates reports for admins", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/api/reports/longest-traces/regenerate",
    });
    expect(res.statusCode).toBe(200);
    expect(LongestTracesReportGenerate).toHaveBeenCalled();
  });
});
