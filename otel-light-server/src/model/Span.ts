export class Span {
  traceId: string;
  spanId: string;
  name: string;
  serviceName: string;
  serviceVersion: string;
  startTime: number;
  endTime: number;

  constructor(data?: Partial<Span>) {
    if (data) {
      Object.assign(this, data);
    }
  }
}
