import Fastify from "fastify";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  AuthGetLiveUser: jest.fn(),
  AuthMustBeAuthenticated: jest.fn(),
}));

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsGetType: jest.fn(() => "sqlite"),
  DbUtilsQuerySQL: jest.fn(),
  DbUtilsExecSQL: jest.fn(),
}));

import {
  AuthGetLiveUser,
  AuthMustBeAuthenticated,
} from "@devopsplaybook.io/common-utils";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
} from "../utils-std-ts/DbUtils";
import { SavedViewsRoutes } from "./SavedViewsRoutes";

interface Loose {
  id: string;
  userId: string;
  name: string;
  signalType: string;
  query: string;
  shared: number;
  dateCreated: string;
  dateUpdated: string;
}

const OWNER = { id: "user-owner", role: "user" as const, scopes: [] };
const OTHER = { id: "user-other", role: "user" as const, scopes: [] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendUnauthenticated(res: any): void {
  res
    .status(401)
    .send({ error: "Authentication Required", code: "UNAUTHENTICATED" });
  throw new Error("Authentication Required");
}

function mockAuthUser(
  user: { id: string; role: "admin" | "user"; scopes: string[] } | null,
): void {
  (AuthGetLiveUser as jest.Mock).mockResolvedValue(user);
  (AuthMustBeAuthenticated as jest.Mock).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_req: unknown, res: any) => {
      if (!user) {
        sendUnauthenticated(res);
      }
    },
  );
}

describe("SavedViewsRoutes", () => {
  let fastify: ReturnType<typeof Fastify>;
  let views: Loose[];

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(new SavedViewsRoutes().getRoutes, {
      prefix: "/api/saved-views",
    });
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser(OWNER);
    views = [];
    (DbUtilsQuerySQL as jest.Mock).mockImplementation(
      async (_span: unknown, sql: string, params: unknown[]) => {
        if (sql.includes("FROM saved_views WHERE id = ?") ||
            sql.includes('FROM saved_views WHERE "id" = $1')) {
          return views.filter((view) => view.id === params[0]);
        }
        return views.filter(
          (view) =>
            (view.userId === params[0] || view.shared === 1) &&
            (params.length < 2 || view.signalType === params[1]),
        );
      },
    );
    (DbUtilsExecSQL as jest.Mock).mockImplementation(
      async (_span: unknown, sql: string, params: unknown[]) => {
        if (sql.startsWith("INSERT")) {
          views.push({
            id: String(params[0]),
            userId: String(params[1]),
            name: String(params[2]),
            signalType: String(params[3]),
            query: String(params[4]),
            shared: Number(params[5]),
            dateCreated: String(params[6]),
            dateUpdated: String(params[7]),
          });
        } else if (sql.startsWith("UPDATE")) {
          const view = views.find((entry) => entry.id === params[3]);
          if (view) {
            view.name = String(params[0]);
            view.shared = Number(params[1]);
            view.dateUpdated = String(params[2]);
          }
        } else if (sql.startsWith("DELETE")) {
          views = views.filter((entry) => entry.id !== params[0]);
        }
      },
    );
  });

  const seed = (overrides: Partial<Loose> = {}): Loose => {
    const view: Loose = {
      id: "view-1",
      userId: OWNER.id,
      name: "Errors",
      signalType: "logs",
      query: "severity=error&from=1",
      shared: 0,
      dateCreated: "2026-01-01T00:00:00.000Z",
      dateUpdated: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
    views.push(view);
    return view;
  };

  it("requires authentication for every endpoint", async () => {
    mockAuthUser(null);
    for (const request of [
      { method: "GET" as const, url: "/api/saved-views" },
      {
        method: "POST" as const,
        url: "/api/saved-views",
        payload: { name: "x", signalType: "logs", query: "" },
      },
      { method: "PATCH" as const, url: "/api/saved-views/view-1", payload: {} },
      { method: "DELETE" as const, url: "/api/saved-views/view-1" },
    ]) {
      const res = await fastify.inject(request);
      expect(res.statusCode).toBe(401);
    }
  });

  it("lists the user's own views and shared views", async () => {
    seed();
    seed({ id: "view-2", userId: OTHER.id, name: "Shared", shared: 1 });
    seed({ id: "view-3", userId: OTHER.id, name: "Hidden" });

    const res = await fastify.inject({ method: "GET", url: "/api/saved-views" });
    expect(res.statusCode).toBe(200);
    expect(res.json().views.map((view: Loose) => view.id)).toEqual([
      "view-1",
      "view-2",
    ]);
    const sql = (DbUtilsQuerySQL as jest.Mock).mock.calls[0][1];
    expect(sql).toContain("userId");
    expect(sql).toContain("shared");
  });

  it("filters by signalType and rejects unknown signal types", async () => {
    seed();
    seed({ id: "view-2", signalType: "traces" });
    const ok = await fastify.inject({
      method: "GET",
      url: "/api/saved-views?signalType=traces",
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().views.map((view: Loose) => view.id)).toEqual(["view-2"]);

    const bad = await fastify.inject({
      method: "GET",
      url: "/api/saved-views?signalType=metrics",
    });
    expect(bad.statusCode).toBe(400);
  });

  it("creates a private view by default and a shared view when asked", async () => {
    const created = await fastify.inject({
      method: "POST",
      url: "/api/saved-views",
      payload: { name: " Slow checkout ", signalType: "traces", query: "a=1" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().view).toMatchObject({
      userId: OWNER.id,
      name: "Slow checkout",
      shared: false,
    });

    const shared = await fastify.inject({
      method: "POST",
      url: "/api/saved-views",
      payload: {
        name: "Team view",
        signalType: "logs",
        query: "",
        shared: true,
      },
    });
    expect(shared.statusCode).toBe(201);
    expect(shared.json().view.shared).toBe(true);
    expect(views.find((view) => view.name === "Team view")?.shared).toBe(1);
  });

  it("validates the create payload", async () => {
    const cases = [
      { name: "", signalType: "logs", query: "" },
      { name: "x", signalType: "metrics", query: "" },
      { name: "x", signalType: "logs", query: {} },
      { name: "x", signalType: "logs", query: "", shared: "yes" },
      { name: "x".repeat(101), signalType: "logs", query: "" },
    ];
    for (const payload of cases) {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/saved-views",
        payload,
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    }
    expect(DbUtilsExecSQL).not.toHaveBeenCalled();
  });

  it("renames and shares only the owner's own view", async () => {
    seed();
    const renamed = await fastify.inject({
      method: "PATCH",
      url: "/api/saved-views/view-1",
      payload: { name: "Errors 500", shared: true },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().view).toMatchObject({
      name: "Errors 500",
      shared: true,
    });

    seed({ id: "view-2", userId: OTHER.id });
    mockAuthUser(OWNER);
    const forbidden = await fastify.inject({
      method: "PATCH",
      url: "/api/saved-views/view-2",
      payload: { name: "Hijack" },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe("FORBIDDEN");

    const missing = await fastify.inject({
      method: "PATCH",
      url: "/api/saved-views/nope",
      payload: { name: "Hijack" },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("deletes only the owner's view", async () => {
    seed();
    seed({ id: "view-2", userId: OTHER.id });

    const forbidden = await fastify.inject({
      method: "DELETE",
      url: "/api/saved-views/view-2",
    });
    expect(forbidden.statusCode).toBe(403);

    const deleted = await fastify.inject({
      method: "DELETE",
      url: "/api/saved-views/view-1",
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect(views.map((view) => view.id)).toEqual(["view-2"]);
  });
});
