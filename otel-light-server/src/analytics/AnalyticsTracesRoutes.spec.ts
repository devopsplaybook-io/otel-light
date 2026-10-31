import Fastify from "fastify";

jest.mock("../utils-std-ts/DbUtilsNoTelemetry", () => ({
  DbUtilsNoTelemetryQuerySQL: jest.fn(),
}));

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  AuthHasScope: jest.fn(),
}));

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import { AuthHasScope } from "@devopsplaybook.io/common-utils";
import { AnalyticsTracesRoutes } from "./AnalyticsTracesRoutes";

const deny = (
  mock: jest.Mock,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) =>
  mock.mockImplementation(async (_req: unknown, res: any) => {
    res.status(403).send({ error: "Access Denied", code: "FORBIDDEN" });
    throw new Error("Access Denied");
  });

const denyUnauthenticated = (
  mock: jest.Mock,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) =>
  mock.mockImplementation(async (_req: unknown, res: any) => {
    res
      .status(401)
      .send({ error: "Authentication Required", code: "UNAUTHENTICATED" });
    throw new Error("Authentication Required");
  });

describe("AnalyticsTracesRoutes trace logs", () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(new AnalyticsTracesRoutes().getRoutes, {
      prefix: "/api/analytics/traces",
    });
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthHasScope as jest.Mock).mockResolvedValue(undefined);
    (DbUtilsNoTelemetryQuerySQL as jest.Mock).mockResolvedValue([]);
  });

  it("returns 401 when not authenticated", async () => {
    denyUnauthenticated(AuthHasScope as jest.Mock);

    const res = await fastify.inject({
      method: "GET",
      url: "/api/analytics/traces/t-1/logs",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
    expect(DbUtilsNoTelemetryQuerySQL).not.toHaveBeenCalled();
  });

  it("requires the logs scope and skips the query when it is denied", async () => {
    deny(AuthHasScope as jest.Mock);

    const res = await fastify.inject({
      method: "GET",
      url: "/api/analytics/traces/t-1/logs",
    });

    expect(res.statusCode).toBe(403);
    expect(AuthHasScope).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "logs",
    );
    expect(DbUtilsNoTelemetryQuerySQL).not.toHaveBeenCalled();
  });

  it("returns log-shaped records", async () => {
    (DbUtilsNoTelemetryQuerySQL as jest.Mock).mockResolvedValue([
      {
        recordId: "r-1",
        traceId: "t-1",
        spanId: "s-1",
        serviceName: "svc",
        serviceVersion: "1.0.0",
        severity: "INFO",
        time: 123,
        logText: "hello",
        attributes: '{"key":"value"}',
        keywords: "hello",
      },
    ]);

    const res = await fastify.inject({
      method: "GET",
      url: "/api/analytics/traces/t-1/logs",
    });

    expect(res.statusCode).toBe(200);
    const log = res.json().logs[0];
    expect(log).toMatchObject({
      recordId: "r-1",
      traceId: "t-1",
      spanId: "s-1",
      logText: "hello",
    });
    expect(log.attributes).toEqual({ key: "value" });
    expect(log.rawSpan).toBeUndefined();
  });

  it("still requires the traces scope for the spans endpoint", async () => {
    deny(AuthHasScope as jest.Mock);

    const res = await fastify.inject({
      method: "GET",
      url: "/api/analytics/traces/t-1/spans",
    });

    expect(res.statusCode).toBe(403);
    expect(AuthHasScope).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "traces",
    );
    expect(DbUtilsNoTelemetryQuerySQL).not.toHaveBeenCalled();
  });
});
