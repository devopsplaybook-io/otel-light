export class Metric {
  name: string;
  serviceName: string;
  serviceVersion: string;
  time: number;
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(inputData?: any) {
    if (inputData.name) this.name = inputData.name;
    if (inputData.serviceName) this.serviceName = inputData.serviceName;
    if (inputData.serviceVersion)
      this.serviceVersion = inputData.serviceVersion;
    if (inputData.time) this.time = inputData.time;
    if (inputData.type) this.type = inputData.type;
    if (inputData.rawMetric) {
      this.data = JSON.parse(inputData.rawMetric);
    }
  }
}
