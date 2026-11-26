import * as nodeFs from "fs";
import * as os from "os";
import * as path from "path";
import Fastify, { FastifyInstance } from "fastify";
import {
  AuthInit,
  AuthSetOTel,
  DbUtilsExecSQL,
  DbUtilsGetDatabase,
  DbUtilsInit,
  DbUtilsSetOTel,
  UsersApiTokensDataSetOTel,
  UsersDataSetOTel,
  UsersRoutes,
} from "@devopsplaybook.io/common-utils";
import { RateLimitsInit } from "./RateLimits";

const mockSpan = {
  setAttribute: jest.fn(),
  setAttributes: jest.fn(),
  addEvent: jest.fn(),
  setStatus: jest.fn(),
  end: jest.fn(),
};
const mockTracer = { startSpan: jest.fn(() => mockSpan) } as never;
const mockModuleLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
const mockStandardLogger = {
  createModuleLogger: jest.fn(() => mockModuleLogger),
} as never;

const JWT_KEY =
  "9f2c4d6e8a0b1c3d5e7f9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d";

let baseDir: string;
let app: FastifyInstance | undefined;

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function closeCurrentDb(): void {
  const db = DbUtilsGetDatabase() as unknown as
    | { close: () => void }
    | undefined;
  try {
    db?.close();
  } catch {
    // already closed
  }
}

async function boot(options: {
  loginCodeEnabled: boolean;
  dropTable?: boolean;
}): Promise<void> {
  baseDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "login-codes-"));

  DbUtilsSetOTel(mockTracer, mockStandardLogger);
  AuthSetOTel(mockTracer);
  UsersDataSetOTel(mockTracer);
  UsersApiTokensDataSetOTel(mockTracer);

  await DbUtilsInit(
    undefined as never,
    { DATABASE_TYPE: "sqlite", DATA_DIR: path.join(baseDir, "data") } as never,
    path.join(__dirname, "../sql/sqlite"),
  );
  if (options.dropTable) {
    DbUtilsExecSQL(undefined as never, 'DROP TABLE "users_login_codes"', []);
  }

  await AuthInit(
    undefined as never,
    {
      JWT_KEY,
      JWT_VALIDITY_DURATION: 3600,
      DATABASE_TYPE: "sqlite",
      LOGIN_CODE_ENABLED: options.loginCodeEnabled,
    } as never,
    ["traces", "metrics", "logs"],
  );

  app = Fastify();
  // Mirror production ordering: the host registers @fastify/rate-limit before
  // the users routes, so LoginCodesRoutes must reuse the existing decorator.
  await RateLimitsInit(app, {
    INGESTION_RATE_LIMIT_MAX: 0,
    INGESTION_RATE_LIMIT_WINDOW_SECONDS: 60,
    LOGIN_RATE_LIMIT_MAX: 0,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60,
  });
  await app.register(new UsersRoutes().getRoutes, { prefix: "/api/users" });
  await app.ready();
}

async function login(name: string, password: string): Promise<string> {
  const res = await app!.inject({
    method: "POST",
    url: "/api/users/session",
    payload: { name, password },
  });
  expect(res.statusCode).toBe(201);
  return res.json().token as string;
}

async function bootstrapAdmin(
  name = "root",
  password = "root-pass",
): Promise<string> {
  const created = await app!.inject({
    method: "POST",
    url: "/api/users/",
    payload: { name, password },
  });
  expect(created.statusCode).toBe(201);
  return login(name, password);
}

async function createApiToken(jwtToken: string): Promise<string> {
  const res = await app!.inject({
    method: "POST",
    url: "/api/users/tokens",
    payload: { name: "machine-client" },
    headers: auth(jwtToken),
  });
  expect(res.statusCode).toBe(201);
  return res.json().token as string;
}

async function createLoginCode(): Promise<{
  code: string;
  requestToken: string;
}> {
  const res = await app!.inject({
    method: "POST",
    url: "/api/users/login-codes/",
    headers: { "user-agent": "DeviceCheck/1.0" },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { code: string; requestToken: string };
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  closeCurrentDb();
  if (baseDir) nodeFs.rmSync(baseDir, { recursive: true, force: true });
});

describe("login-with-code routes", () => {
  test("reports enabled and available when the flag is on and the table exists", async () => {
    await boot({ loginCodeEnabled: true });

    const res = await app!.inject({
      method: "GET",
      url: "/api/users/login-codes/capabilities",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toMatchObject({
      enabled: true,
      available: true,
      codeLength: 8,
      rotationSeconds: 30,
      graceSeconds: 60,
      ttlSeconds: 300,
      pollIntervalMs: 2000,
      approveRequiresPassword: false,
    });
  });

  test("mounts no login-code route when the flag is off", async () => {
    await boot({ loginCodeEnabled: false });

    const capabilities = await app!.inject({
      method: "GET",
      url: "/api/users/login-codes/capabilities",
    });
    expect(capabilities.statusCode).toBe(404);

    const create = await app!.inject({
      method: "POST",
      url: "/api/users/login-codes/",
    });
    expect(create.statusCode).toBe(404);
  });

  test("reports unavailable and answers 503 when the table is missing", async () => {
    await boot({ loginCodeEnabled: true, dropTable: true });

    const capabilities = await app!.inject({
      method: "GET",
      url: "/api/users/login-codes/capabilities",
    });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json()).toMatchObject({
      enabled: true,
      available: false,
    });

    const create = await app!.inject({
      method: "POST",
      url: "/api/users/login-codes/",
    });
    expect(create.statusCode).toBe(503);
    expect(create.json().code).toBe("LOGIN_CODE_UNAVAILABLE");
  });

  test("rejects API tokens and unauthenticated callers on preview/approve", async () => {
    await boot({ loginCodeEnabled: true });
    const jwtToken = await bootstrapAdmin();
    const apiToken = await createApiToken(jwtToken);
    const { code } = await createLoginCode();

    const previewWithApiToken = await app!.inject({
      method: "POST",
      url: "/api/users/login-codes/preview",
      payload: { code },
      headers: auth(apiToken),
    });
    expect(previewWithApiToken.statusCode).toBe(403);
    expect(previewWithApiToken.json().code).toBe("FORBIDDEN");

    const approveWithApiToken = await app!.inject({
      method: "POST",
      url: "/api/users/login-codes/approve",
      payload: { code },
      headers: auth(apiToken),
    });
    expect(approveWithApiToken.statusCode).toBe(403);
    expect(approveWithApiToken.json().code).toBe("FORBIDDEN");

    const previewUnauthenticated = await app!.inject({
      method: "POST",
      url: "/api/users/login-codes/preview",
      payload: { code },
    });
    expect(previewUnauthenticated.statusCode).toBe(401);
    expect(previewUnauthenticated.json().code).toBe("UNAUTHENTICATED");
  });

  test("supports the single-use create, preview, approve and poll flow", async () => {
    await boot({ loginCodeEnabled: true });
    const jwtToken = await bootstrapAdmin();

    const { code, requestToken } = await createLoginCode();
    expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/);
    expect(typeof requestToken).toBe("string");

    const preview = await app!.inject({
      method: "POST",
      url: "/api/users/login-codes/preview",
      payload: { code },
      headers: auth(jwtToken),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().userName).toBe("root");

    const approve = await app!.inject({
      method: "POST",
      url: "/api/users/login-codes/approve",
      payload: { code },
      headers: auth(jwtToken),
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().approved).toBe(true);

    const poll = await app!.inject({
      method: "POST",
      url: "/api/users/login-codes/poll",
      payload: { requestToken },
    });
    expect(poll.statusCode).toBe(200);
    expect(poll.json().status).toBe("approved");
    const sessionToken = poll.json().token as string;
    expect(typeof sessionToken).toBe("string");

    const users = await app!.inject({
      method: "GET",
      url: "/api/users/",
      headers: auth(sessionToken),
    });
    expect(users.statusCode).toBe(200);
    expect(users.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "root" })]),
    );

    const secondApprove = await app!.inject({
      method: "POST",
      url: "/api/users/login-codes/approve",
      payload: { code },
      headers: auth(jwtToken),
    });
    expect(secondApprove.statusCode).toBe(400);
    expect(secondApprove.json().code).toBe("INVALID_CODE");

    const secondPoll = await app!.inject({
      method: "POST",
      url: "/api/users/login-codes/poll",
      payload: { requestToken },
    });
    expect(secondPoll.statusCode).toBe(409);
    expect(secondPoll.json().code).toBe("ALREADY_USED");
  });

  test("rejects an unknown code with the stable INVALID_CODE error", async () => {
    await boot({ loginCodeEnabled: true });
    const jwtToken = await bootstrapAdmin();

    const res = await app!.inject({
      method: "POST",
      url: "/api/users/login-codes/preview",
      payload: { code: "BCDFGHJK" },
      headers: auth(jwtToken),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_CODE");
  });
});
