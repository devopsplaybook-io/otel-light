import { Span } from "@opentelemetry/sdk-trace-base";
import * as jwt from "jsonwebtoken";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Config } from "../Config";
import { User } from "../model/User";
import { UserSession } from "../model/UserSession";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { DbUtilsQuerySQL } from "../utils-std-ts/DbUtils";

const logger = OTelLogger().createModuleLogger(path.basename(__filename));
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
    },
    config.JWT_KEY,
  );
}

export async function AuthMustBeAuthenticated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
): Promise<void> {
  let authenticated = false;
  if (req.headers.authorization) {
    try {
      jwt.verify(req.headers.authorization.split(" ")[1], config.JWT_KEY);
      authenticated = true;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_err) {
      authenticated = false;
    }
  }
  if (!authenticated) {
    res.status(403).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function AuthGetUserSession(req: any): Promise<UserSession> {
  const userSession: UserSession = { isAuthenticated: false };
  if (req.headers.authorization) {
    try {
      const info = jwt.verify(
        req.headers.authorization.split(" ")[1],
        config.JWT_KEY,
      );
      userSession.userId = info.userId;
      userSession.isAuthenticated = true;
    } catch (err) {
      logger.error("Error getting user session", err);
    }
  }
  return userSession;
}

// SQL

const SQL_QUERIES = {
  GET_AUTH_TOKEN: {
    postgres:
      "SELECT value FROM metadata WHERE \"type\" = 'auth_token' LIMIT 1",
    sqlite: 'SELECT value FROM metadata WHERE type = "auth_token" LIMIT 1',
  },
  INSERT_AUTH_TOKEN: {
    postgres: 'INSERT INTO metadata ("type", "value", "dateCreated") VALUES (\'auth_token\', ?, ?)',
    sqlite: 'INSERT INTO metadata (type, value, dateCreated) VALUES ("auth_token", ?, ?)',
  },
};
