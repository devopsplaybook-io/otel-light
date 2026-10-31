// H3 regression: stats, services, reports and recommendation routes must
// enforce authentication, signal scopes and admin rights. The common-utils 2.x
// guards answer 401 UNAUTHENTICATED when there is no live user and 403 FORBIDDEN
// when the live user lacks the scope or the admin role; the mocks below
// reproduce that contract (the live user, not the JWT claims, decides).

import Fastify from "fastify";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  AuthGetLiveUser: jest.fn(),
  AuthMustBeAuthenticated: jest.fn(),
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
  AuthGetLiveUser,
  AuthHasScope,
  AuthMustBeAdmin,
  AuthMustBeAuthenticated,
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

interface MockLiveUser {
  role: "admin" | "user";
  scopes: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendUnauthenticated(res: any): void {
  res
    .status(401)
    .send({ error: "Authentication Required", code: "UNAUTHENTICATED" });
  throw new Error("Authentication Required");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendForbidden(res: any): void {
  res.status(403).send({ error: "Access Denied", code: "FORBIDDEN" });
  throw new Error("Access Denied");
}

function mockAuthUser(user: MockLiveUser | null): void {
  (AuthGetLiveUser as jest.Mock).mockResolvedValue(user);
  (AuthMustBeAuthenticated as jest.Mock).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_req: unknown, res: any) => {
      if (!user) {
        sendUnauthenticated(res);
      }
    },
  );
  (AuthHasScope as jest.Mock).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_req: unknown, res: any, scope: string) => {
      if (!user) {
        sendUnauthenticated(res);
      }
      if (user.role !== "admin" && !user.scopes.includes(scope)) {
        sendForbidden(res);
      }
    },
  );
  (AuthMustBeAdmin as jest.Mock).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_req: unknown, res: any) => {
      if (!user) {
        sendUnauthenticated(res);
      }
      if (user.role !== "admin") {
        sendForbidden(res);
      }
    },
  );
}

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
    mockAuthUser({ role: "user", scopes: ["traces", "metrics", "logs"] });
    (DbUtilsNoTelemetryQuerySQL as jest.Mock).mockResolvedValue([]);
    (AnalyticsCacheGetServices as jest.Mock).mockReturnValue({
      services: ["svc-a"],
      serviceVersions: [{ serviceName: "svc-a", serviceVersion: "1.0" }],
    });
    (LongestTracesReportGetCached as jest.Mock).mockResolvedValue(null);
    (MostCalledTracesReportGetCached as jest.Mock).mockResolvedValue(null);
    (LongestTracesReportGenerate as jest.Mock).mockResolvedValue(undefined);
    (MostCalledTracesReportGenerate as jest.Mock).mockResolvedValue(undefined);
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

  it.each(GET_ENDPOINTS)(
    "returns 401 when not authenticated: %s",
    async (url) => {
      mockAuthUser(null);
      const res = await fastify.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("UNAUTHENTICATED");
    },
  );

  it.each([
    ["/api/analytics/logs/stats", "logs"],
    ["/api/analytics/traces/stats", "traces"],
    ["/api/reports/longest-traces", "traces"],
    ["/api/reports/most-called-traces", "traces"],
    ["/api/recommendation", "traces"],
  ])(
    "returns 403 and asks for the %s scope on %s when it is denied",
    async (url, scope) => {
      mockAuthUser({ role: "user", scopes: [] });
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
    mockAuthUser({ role: "user", scopes: [] });
    const denied = await fastify.inject({
      method: "GET",
      url: "/api/analytics/services",
    });
    expect(denied.statusCode).toBe(403);

    mockAuthUser({ role: "user", scopes: ["metrics"] });
    const allowed = await fastify.inject({
      method: "GET",
      url: "/api/analytics/services",
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().services).toEqual(["svc-a"]);
  });

  it("grants the service list to admins", async () => {
    mockAuthUser({ role: "admin", scopes: [] });
    const res = await fastify.inject({
      method: "GET",
      url: "/api/analytics/services",
    });
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ["/api/reports/longest-traces/regenerate", LongestTracesReportGenerate],
    [
      "/api/reports/most-called-traces/regenerate",
      MostCalledTracesReportGenerate,
    ],
  ])(
    "returns 403 without admin rights on POST %s",
    async (url, generateMock) => {
      mockAuthUser({ role: "user", scopes: ["traces", "metrics", "logs"] });
      const res = await fastify.inject({ method: "POST", url });
      expect(res.statusCode).toBe(403);
      expect(generateMock).not.toHaveBeenCalled();
    },
  );

  it("returns 403 without admin rights on POST /api/recommendation/regenerate", async () => {
    mockAuthUser({ role: "user", scopes: ["traces", "metrics", "logs"] });
    const res = await fastify.inject({
      method: "POST",
      url: "/api/recommendation/regenerate",
    });
    expect(res.statusCode).toBe(403);
  });

  it("regenerates reports for admins", async () => {
    mockAuthUser({ role: "admin", scopes: [] });
    const res = await fastify.inject({
      method: "POST",
      url: "/api/reports/longest-traces/regenerate",
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ started: true });
    expect(LongestTracesReportGenerate).toHaveBeenCalled();
  });

  it.each([
    ["/api/reports/longest-traces/regenerate", LongestTracesReportGenerate],
    [
      "/api/reports/most-called-traces/regenerate",
      MostCalledTracesReportGenerate,
    ],
  ])(
    "accepts %s without waiting for the background generation",
    async (url, generateMock) => {
      mockAuthUser({ role: "admin", scopes: [] });
      // A generation that never settles proves the route returns immediately
      // (202) instead of blocking the HTTP request on the full report scan.
      (generateMock as jest.Mock).mockReturnValue(new Promise(() => undefined));
      const res = await fastify.inject({ method: "POST", url });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ started: true });
      expect(generateMock).toHaveBeenCalled();
    },
  );
});
