import Fastify from "fastify";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  AuthMustBeAdmin: jest.fn(),
}));

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsQuerySQL: jest.fn(),
  DbUtilsExecSQL: jest.fn(),
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

import { AuthMustBeAdmin } from "@devopsplaybook.io/common-utils";
import { DbUtilsQuerySQL } from "../utils-std-ts/DbUtils";
import { SettingsRoutes } from "./SettingsRoutes";

const deny = (
  mock: jest.Mock,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) =>
  mock.mockImplementation(async (_req: unknown, res: any) => {
    res.status(403).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  });

describe("SettingsRoutes GET /api/settings/:category", () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(new SettingsRoutes().getRoutes, {
      prefix: "/api/settings",
    });
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthMustBeAdmin as jest.Mock).mockResolvedValue(undefined);
    (DbUtilsQuerySQL as jest.Mock).mockResolvedValue([]);
  });

  it("returns 403 and skips the database for non-admins", async () => {
    deny(AuthMustBeAdmin as jest.Mock);

    const res = await fastify.inject({
      method: "GET",
      url: "/api/settings/maintenance",
    });

    expect(res.statusCode).toBe(403);
    expect(DbUtilsQuerySQL).not.toHaveBeenCalled();
  });

  it("returns 200 with the settings for admins", async () => {
    (DbUtilsQuerySQL as jest.Mock).mockResolvedValue([
      { category: "maintenance", content: '{"deleteRules":[]}' },
    ]);

    const res = await fastify.inject({
      method: "GET",
      url: "/api/settings/maintenance",
    });

    expect(res.statusCode).toBe(200);
    expect(AuthMustBeAdmin).toHaveBeenCalled();
    expect(DbUtilsQuerySQL).toHaveBeenCalledTimes(1);
    expect(res.json().settings).toEqual({
      category: "maintenance",
      content: { deleteRules: [] },
    });
  });

  it("returns default content when the category is not stored yet", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/api/settings/error-alert-rules",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toEqual({
      category: "error-alert-rules",
      content: {},
    });
  });
});
