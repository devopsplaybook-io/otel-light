export class Log {
  serviceName: string;
  serviceVersion: string;
  severity: string;
  time: number;
  logText: string;
  atttributes: string;
  keywords: string;

  constructor(data?: Partial<Log>) {
    if (data) {
      Object.assign(this, data);
    }
  }
}
