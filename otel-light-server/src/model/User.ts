import { v4 as uuidv4 } from "uuid";

export type UserRole = "admin" | "user";
export type UserScope = "traces" | "metrics" | "logs";

export class User {
  //
  public static readonly DEFAULT_SCOPES: UserScope[] = [];
  public static readonly ALL_SCOPES: UserScope[] = [
    "traces",
    "metrics",
    "logs",
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static fromJson(json: any): User {
    if (!json) {
      return null;
    }
    const user = new User();
    if (json.id) {
      user.id = json.id;
    }
    user.id = json.id;
    user.name = json.name;
    user.passwordEncrypted = json.passwordEncrypted;
    user.role = json.role || "user";
    if (json.scopes) {
      try {
        user.scopes =
          typeof json.scopes === "string"
            ? JSON.parse(json.scopes)
            : json.scopes;
      } catch {
        user.scopes = [...User.DEFAULT_SCOPES];
      }
    }
    return user;
  }

  public id: string;
  public name: string;
  public passwordEncrypted: string;
  public role: UserRole = "user";
  public scopes: UserScope[] = [...User.DEFAULT_SCOPES];

  constructor() {
    this.id = uuidv4();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public toJson(): any {
    return {
      id: this.id,
      name: this.name,
      passwordEncrypted: this.passwordEncrypted,
      role: this.role,
      scopes: this.scopes,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public toTransportJson(): any {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      scopes: this.scopes,
    };
  }
}
