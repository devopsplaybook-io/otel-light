import Fastify from "fastify";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  AuthMustBeAdmin: jest.fn(),
}));

jest.mock("./ErrorAlerts", () => ({
  ErrorAlertsGetStatus: jest.fn(),
}));

import { AuthMustBeAdmin } from "@devopsplaybook.io/common-utils";
import { ErrorAlertsGetStatus } from "./ErrorAlerts";
import { ErrorAlertsRoutes } from "./ErrorAlertsRoutes";

const deny = (
  mock: jest.Mock,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) =>
  mock.mockImplementation(async (_req: unknown, res: any) => {
    res.status(403).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  });

describe("ErrorAlertsRoutes GET /api/alerts/status", () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(new ErrorAlertsRoutes().getRoutes, {
      prefix: "/api/alerts",
    });
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthMustBeAdmin as jest.Mock).mockResolvedValue(undefined);
    (ErrorAlertsGetStatus as jest.Mock).mockResolvedValue({
      enabled: true,
      evaluations: {},
    });
  });

  it("returns 403 and skips the status lookup for non-admins", async () => {
    deny(AuthMustBeAdmin as jest.Mock);

    const res = await fastify.inject({
      method: "GET",
      url: "/api/alerts/status",
    });

    expect(res.statusCode).toBe(403);
    expect(ErrorAlertsGetStatus).not.toHaveBeenCalled();
  });

  it("returns the alert status for admins", async () => {
    const status = {
      enabled: false,
      evaluations: { rule1: { at: "2026-10-24T00:00:00.000Z" } },
    };
    (ErrorAlertsGetStatus as jest.Mock).mockResolvedValue(status);

    const res = await fastify.inject({
      method: "GET",
      url: "/api/alerts/status",
    });

    expect(res.statusCode).toBe(200);
    expect(AuthMustBeAdmin).toHaveBeenCalled();
    expect(res.json()).toEqual(status);
  });
});
