import axios from "axios";
import Config from "./Config";
import { AuthService } from "./AuthService";

export class UserService {
  //
  public static async isInitialized(): Promise<boolean> {
    return (
      await axios.get(
        `${(await Config.get()).SERVER_URL}/users/status/initialization`,
      )
    ).data.initialized;
  }

  public static async login(name: string, password: string): Promise<any> {
    const config = await Config.get();
    return axios.post(`${config.SERVER_URL}/users/session`, {
      name,
      password,
    });
  }

  public static async register(name: string, password: string): Promise<any> {
    const config = await Config.get();
    return axios.post(`${config.SERVER_URL}/users`, {
      name,
      password,
    });
  }

  // ==================== Admin CRUD ====================

  public static async list(): Promise<any> {
    const config = await Config.get();
    return axios.get(
      `${config.SERVER_URL}/users`,
      await AuthService.getAuthHeader(),
    );
  }

  public static async create(opts: {
    name: string;
    password: string;
    role?: string;
    scopes?: string[];
  }): Promise<any> {
    const config = await Config.get();
    return axios.post(
      `${config.SERVER_URL}/users`,
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
    const config = await Config.get();
    return axios.put(
      `${config.SERVER_URL}/users/${id}`,
      opts,
      await AuthService.getAuthHeader(),
    );
  }

  public static async delete(id: string): Promise<any> {
    const config = await Config.get();
    return axios.delete(
      `${config.SERVER_URL}/users/${id}`,
      await AuthService.getAuthHeader(),
    );
  }
}
