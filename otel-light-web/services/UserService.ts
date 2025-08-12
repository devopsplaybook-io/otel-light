import axios from "axios";
import Config from "./Config";

const AUTH_TOKEN_KEY = "auth_token";

export class UserService {
  //
  public static async isInitialized(): Promise<boolean> {
    return (await axios.get(`${(await Config.get()).SERVER_URL}/users/status/initialization`)).data.initialized;
  }
}
