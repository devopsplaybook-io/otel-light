import axios from "axios";
import { SERVER_URL } from "./Config";
import { AuthService } from "./AuthService";

export class UserService {
  //
  public static async isInitialized(): Promise<boolean> {
    return (await axios.get(`${SERVER_URL}/users/status/initialization`)).data
      .initialized;
  }

  public static async login(name: string, password: string): Promise<any> {
    return axios.post(`${SERVER_URL}/users/session`, {
      name,
      password,
    });
  }

  public static async register(name: string, password: string): Promise<any> {
    return axios.post(`${SERVER_URL}/users`, {
      name,
      password,
    });
  }

  // ==================== Admin CRUD ====================

  public static async list(): Promise<any> {
    return axios.get(`${SERVER_URL}/users`, await AuthService.getAuthHeader());
  }

  public static async create(opts: {
    name: string;
    password: string;
    role?: string;
    scopes?: string[];
  }): Promise<any> {
    return axios.post(
      `${SERVER_URL}/users`,
      opts,
      await AuthService.getAuthHeader(),
    );
  }

  public static async update(
    id: string,
    opts: {
      role?: string;
      scopes?: string[];
      password?: string;
    },
  ): Promise<any> {
    return axios.put(
      `${SERVER_URL}/users/${id}`,
      opts,
      await AuthService.getAuthHeader(),
    );
  }

  public static async delete(id: string): Promise<any> {
    return axios.delete(
      `${SERVER_URL}/users/${id}`,
      await AuthService.getAuthHeader(),
    );
  }
}
