import { Span } from "@opentelemetry/sdk-trace-base";
import { User } from "../model/User";
import { DbUtilsExecSQL, DbUtilsQuerySQL, DbUtilsGetType } from "../utils-std-ts/DbUtils";
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
  const usersRaw = await DbUtilsQuerySQL(span, SQL_QUERIES.LIST_USERS[DbUtilsGetType()]);
  const users = [];
  for (const userRaw of usersRaw) {
    users.push(fromRaw(userRaw));
  }
  span.end();
  return users;
}

export async function UsersDataAdd(context: Span, user: User): Promise<void> {
  const span = OTelTracer().startSpan("UsersDataAdd", context);
  await DbUtilsExecSQL(
    span,
    SQL_QUERIES.INSERT_USER[DbUtilsGetType()],
    [user.id, user.name, user.passwordEncrypted],
  );
  span.end();
}

export async function UsersDataUpdate(
  context: Span,
  user: User,
): Promise<void> {
  const span = OTelTracer().startSpan("UsersDataUpdate", context);
  await DbUtilsExecSQL(
    span,
    SQL_QUERIES.UPDATE_USER[DbUtilsGetType()],
    [user.passwordEncrypted, user.id],
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

// SQL

const SQL_QUERIES = {
  GET_USER_BY_ID: {
    postgres: 'SELECT * FROM users WHERE "id" = ?',
    sqlite: 'SELECT * FROM users WHERE id = ?',
  },
  GET_USER_BY_NAME: {
    postgres: 'SELECT * FROM users WHERE "name" = ?',
    sqlite: 'SELECT * FROM users WHERE name = ?',
  },
  LIST_USERS: {
    postgres: 'SELECT * FROM users',
    sqlite: 'SELECT * FROM users',
  },
  INSERT_USER: {
    postgres: 'INSERT INTO users ("id", "name", "passwordEncrypted") VALUES (?, ?, ?)',
    sqlite: 'INSERT INTO users (id, name, passwordEncrypted) VALUES (?, ?, ?)',
  },
  UPDATE_USER: {
    postgres: 'UPDATE users SET "passwordEncrypted" = ? WHERE "id" = ?',
    sqlite: 'UPDATE users SET passwordEncrypted = ? WHERE id = ?',
  },
};
