import { jwtDecode } from "jwt-decode";

export interface JwtTokenInfo {
  userId: string;
  userName: string;
  role: string;
  scopes: string[];
  exp: number;
}

export type UserScope = "traces" | "metrics" | "logs";

const AUTH_TOKEN_KEY = "auth_token";

let _cachedToken: string | null = null;
let _cachedInfo: JwtTokenInfo | null = null;

function decodeToken(token: string): JwtTokenInfo | null {
  try {
    const decoded: any = jwtDecode(token);
    if (decoded.exp < Date.now() / 1000) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      _cachedToken = null;
      _cachedInfo = null;
      return null;
    }
    return decoded as JwtTokenInfo;
  } catch {
    return null;
  }
}

export class AuthService {
  //
  public static isAuthenticated(): boolean {
    return !!AuthService.getToken();
  }

  public static saveToken(token: string): void {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    _cachedToken = token;
    _cachedInfo = decodeToken(token);
  }

  public static removeToken(): void {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    _cachedToken = null;
    _cachedInfo = null;
  }

  public static getToken(): string | null {
    if (_cachedToken) return _cachedToken;
    const storedKey = localStorage.getItem(AUTH_TOKEN_KEY);
    if (storedKey) {
      const info = decodeToken(storedKey);
      if (info) {
        _cachedToken = storedKey;
        _cachedInfo = info;
        return storedKey;
      }
    }
    return null;
  }

  public static getTokenInfo(): JwtTokenInfo | null {
    if (_cachedInfo) return _cachedInfo;
    const storedKey = localStorage.getItem(AUTH_TOKEN_KEY);
    if (storedKey) {
      const info = decodeToken(storedKey);
      if (info) {
        _cachedToken = storedKey;
        _cachedInfo = info;
      }
      return info;
    }
    return null;
  }

  public static isAdmin(): boolean {
    const info = AuthService.getTokenInfo();
    return info?.role === "admin";
  }

  public static hasScope(scope: UserScope): boolean {
    const info = AuthService.getTokenInfo();
    if (!info) return false;
    if (info.role === "admin") return true;
    return info.scopes?.includes(scope) || false;
  }

  public static getAuthHeader(): any {
    try {
      const token = AuthService.getToken();
      if (token) {
        return {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        };
      } else {
        return {};
      }
    } catch {
      return {};
    }
  }
}
