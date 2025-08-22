import * as jwt from "jsonwebtoken";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { User } from "../model/User";
import { UserSession } from "../model/UserSession";
import { Config } from "../Config";
import { Logger } from "../utils-std-ts/Logger";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { SqlDbUtilsQuerySQL } from "../utils-std-ts/SqlDbUtils";

const logger = new Logger(path.basename(__filename));
let config: Config;

export async function AuthInit(context: Span, configIn: Config) {
  config = configIn;
  const span = StandardTracerStartSpan("AuthInit", context);
  const authKeyRaw = await SqlDbUtilsQuerySQL(span, 'SELECT * FROM metadata WHERE type="auth_token"');
  if (authKeyRaw.length == 0) {
    configIn.JWT_KEY = uuidv4();
    await SqlDbUtilsQuerySQL(span, 'INSERT INTO metadata (type, value, dateCreated) VALUES ("auth_token", ?, ?)', [
      configIn.JWT_KEY,
      new Date().toISOString(),
    ]);
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
    config.JWT_KEY
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function AuthMustBeAuthenticated(req: any, res: any): Promise<void> {
  let authenticated = false;
  if (req.headers.authorization) {
    try {
      jwt.verify(req.headers.authorization.split(" ")[1], config.JWT_KEY);
      authenticated = true;
    } catch (err) {
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
      const info = jwt.verify(req.headers.authorization.split(" ")[1], config.JWT_KEY);
      userSession.userId = info.userId;
      userSession.isAuthenticated = true;
    } catch (err) {
      logger.error(err);
    }
  }
  return userSession;
}
