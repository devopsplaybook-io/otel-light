export class Log {
  serviceName: string;
  serviceVersion: string;
  severity: string;
  time: number;
  logText: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attributes: any;
  keywords: string;

  constructor(data?: Partial<Log>) {
    if (data) {
      Object.assign(this, data);
      if (data.attributes && typeof data.attributes === "string") {
        this.attributes = JSON.parse(data.attributes);
      }
    }
  }
}
