export class Trace {
  traceId: string;
  name: string;
  serviceName: string;
  serviceVersion: string;
  startTime: number;
  endTime: number;
  spanCount: number;
  statusCodeSum: number;

  constructor(data?: Partial<Trace>) {
    if (data) {
      Object.assign(this, data);
    }
  }
}
