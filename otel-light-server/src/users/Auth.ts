import { Span } from "@opentelemetry/sdk-trace-base";
import * as jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { Config } from "../Config";
import { User, UserScope } from "../model/User";
import { UserSession } from "../model/UserSession";
import { OTelTracer } from "../OTelContext";
import { DbUtilsQuerySQL } from "../utils-std-ts/DbUtils";

let config: Config;

export async function AuthInit(context: Span, configIn: Config) {
  config = configIn;
  const span = OTelTracer().startSpan("AuthInit", context);
  const authKeyRaw = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.GET_AUTH_TOKEN[configIn.DATABASE_TYPE],
  );
  if (authKeyRaw.length == 0) {
    configIn.JWT_KEY = uuidv4();
    await DbUtilsQuerySQL(
      span,
      SQL_QUERIES.INSERT_AUTH_TOKEN[configIn.DATABASE_TYPE],
      [configIn.JWT_KEY, new Date().toISOString()],
    );
  } else {
    configIn.JWT_KEY = authKeyRaw[0].value;
  }
  span.end();
}

export async function AuthGenerateJWT(user: User): Promise<string> {
  return jwt.sign(
    {
      exp: Math.floor(Date.now() / 1000) + config.JWT_VALIDITY_DURATION,
      userId: user.id,
      userName: user.name,
      role: user.role,
      scopes: user.role === "admin" ? User.ALL_SCOPES : user.scopes,
    },
    config.JWT_KEY,
  );
}

/**
 * Decode JWT from request, caching result on req._jwtPayload to avoid
 * redundant verification when multiple auth functions are called per request.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jwtDecodeCached(req: any): any | null {
  if (req._jwtPayload) {
    return req._jwtPayload;
  }
  if (!req.headers.authorization) {
    return null;
  }
  try {
    const info = jwt.verify(
      req.headers.authorization.split(" ")[1],
      config.JWT_KEY,
    );
    req._jwtPayload = info;
    return info;
  } catch {
    return null;
  }
}

export async function AuthMustBeAuthenticated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
): Promise<void> {
  if (!jwtDecodeCached(req)) {
    res.status(403).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function AuthMustBeAdmin(req: any, res: any): Promise<void> {
  const info = jwtDecodeCached(req);
  if (info?.role === "admin") {
    return;
  }
  res.status(403).send({ error: "Access Denied" });
  throw new Error("Access Denied");
}

export async function AuthHasScope(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
  scope: UserScope,
): Promise<void> {
  const info = jwtDecodeCached(req);
  if (!info) {
    res.status(403).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  }
  if (info.role === "admin") {
    return;
  }
  const scopes: UserScope[] = info.scopes || [];
  if (scopes.includes(scope)) {
    return;
  }
  res.status(403).send({ error: "Access Denied" });
  throw new Error("Access Denied");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function AuthGetUserSession(req: any): Promise<UserSession> {
  const userSession: UserSession = { isAuthenticated: false };
  const info = jwtDecodeCached(req);
  if (info) {
    userSession.userId = info.userId;
    userSession.userName = info.userName;
    userSession.role = info.role;
    userSession.scopes = info.scopes;
    userSession.isAuthenticated = true;
  }
  return userSession;
}

// SQL

const SQL_QUERIES = {
  GET_AUTH_TOKEN: {
    postgres:
      "SELECT value FROM metadata WHERE \"type\" = 'auth_token' LIMIT 1",
    sqlite: "SELECT value FROM metadata WHERE type = 'auth_token' LIMIT 1",
  },
  INSERT_AUTH_TOKEN: {
    postgres:
      'INSERT INTO metadata ("type", "value", "dateCreated") VALUES (\'auth_token\', $1, $2)',
    sqlite:
      "INSERT INTO metadata (type, value, dateCreated) VALUES ('auth_token', ?, ?)",
  },
};
