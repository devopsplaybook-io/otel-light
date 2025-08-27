import { Span } from "@opentelemetry/sdk-trace-base";
import { User } from "../model/User";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "../utils-std-ts/SqlDbUtils";
import { OTelTracer } from "../OTelContext";

export async function UsersDataGet(context: Span, id: string): Promise<User> {
  const span = OTelTracer().startSpan("UsersDataGet", context);
  const usersRaw = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM users WHERE id=?",
    [id]
  );
  let user: User = null;
  if (usersRaw.length > 0) {
    user = fromRaw(usersRaw[0]);
  }
  span.end();
  return user;
}

export async function UsersDataGetByName(
  context: Span,
  name: string
): Promise<User> {
  const span = OTelTracer().startSpan("UsersDataGetByName", context);
  const usersRaw = await SqlDbUtilsQuerySQL(
    span,
    "SELECT * FROM users WHERE name=?",
    [name]
  );
  let user: User = null;
  if (usersRaw.length > 0) {
    user = fromRaw(usersRaw[0]);
  }
  span.end();
  return user;
}

export async function UsersDataList(context: Span): Promise<User[]> {
  const span = OTelTracer().startSpan("UsersDataList", context);
  const usersRaw = await SqlDbUtilsQuerySQL(span, "SELECT * FROM users");
  const users = [];
  for (const userRaw of usersRaw) {
    users.push(fromRaw(userRaw));
  }
  span.end();
  return users;
}

export async function UsersDataAdd(context: Span, user: User): Promise<void> {
  const span = OTelTracer().startSpan("UsersDataAdd", context);
  await SqlDbUtilsExecSQL(
    span,
    "INSERT INTO users (id,name,passwordEncrypted) VALUES (?, ?, ?)",
    [user.id, user.name, user.passwordEncrypted]
  );
  span.end();
}

export async function UsersDataUpdate(
  context: Span,
  user: User
): Promise<void> {
  const span = OTelTracer().startSpan("UsersDataUpdate", context);
  await SqlDbUtilsExecSQL(
    span,
    "UPDATE users SET passwordEncrypted = ? WHERE id = ? ",
    [user.passwordEncrypted, user.id]
  );
  span.end();
}

// Private Functions

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRaw(userRaw: any): User {
  const user = new User();
  user.id = userRaw.id;
  user.name = userRaw.name;
  user.passwordEncrypted = userRaw.passwordEncrypted;
  return user;
}
