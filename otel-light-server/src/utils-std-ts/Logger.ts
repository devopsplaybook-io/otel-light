const DEV_MODE = (() => {
  if (process.env.NODE_ENV === "dev") {
    return true;
  }
  return false;
})();

export class Logger {
  private module: string;

  constructor(module: string) {
    this.module = `${module}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public debug(message: Error | string | any): void {
    if (DEV_MODE) {
      this.display("debug", message);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public info(message: Error | string | any): void {
    this.display("info", message);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public warn(message: Error | string | any): void {
    this.display("warn", message);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public error(message: Error | string | any): void {
    this.display("error", message);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private display(level: string, message: any): void {
    if (typeof message === "string") {
      // eslint:disable-next-line:no-console
      console.log(`[${level}] [${this.module}] ${message}`);
    } else if (message instanceof Error) {
      // eslint:disable-next-line:no-console
      console.log(`${level} [${this.module}] ${message}`);
      // eslint:disable-next-line:no-console
      console.log((message as Error).stack);
    } else if (typeof message === "object") {
      // eslint:disable-next-line:no-console
      console.log(`${level} [${this.module}] ${JSON.stringify(message)}`);
    }
  }
}
