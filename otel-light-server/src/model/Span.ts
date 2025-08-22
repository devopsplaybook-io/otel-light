export class Span {
  traceId: string;
  spanId: string;
  name: string;
  serviceName: string;
  serviceVersion: string;
  startTime: number;
  endTime: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawSpan: any;

  constructor(data?: Partial<Span>) {
    if (data) {
      Object.assign(this, data);
      if (data.traceId) this.traceId = data.traceId;
      if (data.spanId) this.spanId = data.spanId;
      if (data.name) this.name = data.name;
      if (data.serviceName) this.serviceName = data.serviceName;
      if (data.serviceVersion) this.serviceVersion = data.serviceVersion;
      if (data.startTime) this.startTime = data.startTime;
      if (data.endTime) this.endTime = data.endTime;
      if (data.rawSpan && typeof data.rawSpan === "string") {
        this.rawSpan = JSON.parse(data.rawSpan);
      } else if (data.rawSpan && typeof data.rawSpan === "object") {
        this.rawSpan = data.rawSpan;
      }
    }
  }
}
