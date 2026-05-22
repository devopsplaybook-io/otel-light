import { Span } from "@opentelemetry/sdk-trace-base";
import { User } from "../model/User";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsGetType,
} from "../utils-std-ts/DbUtils";
import { OTelTracer } from "../OTelContext";

export async function UsersDataGet(context: Span, id: string): Promise<User> {
  const span = OTelTracer().startSpan("UsersDataGet", context);
  const usersRaw = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.GET_USER_BY_ID[DbUtilsGetType()],
    [id],
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
  name: string,
): Promise<User> {
  const span = OTelTracer().startSpan("UsersDataGetByName", context);
  const usersRaw = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.GET_USER_BY_NAME[DbUtilsGetType()],
    [name],
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
  const usersRaw = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.LIST_USERS[DbUtilsGetType()],
  );
  const users = [];
  for (const userRaw of usersRaw) {
    users.push(fromRaw(userRaw));
  }
  span.end();
  return users;
}

export async function UsersDataAdd(context: Span, user: User): Promise<void> {
  const span = OTelTracer().startSpan("UsersDataAdd", context);
  await DbUtilsExecSQL(span, SQL_QUERIES.INSERT_USER[DbUtilsGetType()], [
    user.id,
    user.name,
    user.passwordEncrypted,
    user.role,
    JSON.stringify(user.scopes),
  ]);
  span.end();
}

export async function UsersDataUpdatePassword(
  context: Span,
  user: User,
): Promise<void> {
  const span = OTelTracer().startSpan("UsersDataUpdatePassword", context);
  await DbUtilsExecSQL(span, SQL_QUERIES.UPDATE_PASSWORD[DbUtilsGetType()], [
    user.passwordEncrypted,
    user.id,
  ]);
  span.end();
}

export async function UsersDataUpdateUser(
  context: Span,
  user: User,
): Promise<void> {
  const span = OTelTracer().startSpan("UsersDataUpdateUser", context);
  await DbUtilsExecSQL(span, SQL_QUERIES.UPDATE_USER[DbUtilsGetType()], [
    user.role,
    JSON.stringify(user.scopes),
    user.id,
  ]);
  span.end();
}

export async function UsersDataDelete(
  context: Span,
  id: string,
): Promise<void> {
  const span = OTelTracer().startSpan("UsersDataDelete", context);
  await DbUtilsExecSQL(span, SQL_QUERIES.DELETE_USER[DbUtilsGetType()], [id]);
  span.end();
}

// Private Functions

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRaw(userRaw: any): User {
  const user = new User();
  user.id = userRaw.id;
  user.name = userRaw.name;
  user.passwordEncrypted = userRaw.passwordEncrypted;
  user.role = userRaw.role || "user";
  if (userRaw.scopes) {
    try {
      user.scopes = JSON.parse(userRaw.scopes);
    } catch {
      user.scopes = [...User.DEFAULT_SCOPES];
    }
  }
  return user;
}

// SQL

const SQL_QUERIES = {
  GET_USER_BY_ID: {
    postgres: 'SELECT * FROM users WHERE "id" = $1',
    sqlite: "SELECT * FROM users WHERE id = ?",
  },
  GET_USER_BY_NAME: {
    postgres: 'SELECT * FROM users WHERE "name" = $1',
    sqlite: "SELECT * FROM users WHERE name = ?",
  },
  LIST_USERS: {
    postgres: "SELECT * FROM users",
    sqlite: "SELECT * FROM users",
  },
  INSERT_USER: {
    postgres:
      'INSERT INTO users ("id", "name", "passwordEncrypted", "role", "scopes") VALUES ($1, $2, $3, $4, $5)',
    sqlite:
      "INSERT INTO users (id, name, passwordEncrypted, role, scopes) VALUES (?, ?, ?, ?, ?)",
  },
  UPDATE_USER: {
    postgres: 'UPDATE users SET "role" = $1, "scopes" = $2 WHERE "id" = $3',
    sqlite: "UPDATE users SET role = ?, scopes = ? WHERE id = ?",
  },
  UPDATE_PASSWORD: {
    postgres: 'UPDATE users SET "passwordEncrypted" = $1 WHERE "id" = $2',
    sqlite: "UPDATE users SET passwordEncrypted = ? WHERE id = ?",
  },
  DELETE_USER: {
    postgres: 'DELETE FROM users WHERE "id" = $1',
    sqlite: "DELETE FROM users WHERE id = ?",
  },
};
