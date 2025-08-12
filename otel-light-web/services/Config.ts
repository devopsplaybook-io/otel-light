export default class Config {
  public static async get(): Promise<any> {
    return {
      SERVER_URL: "/api",
    };
  }
}
