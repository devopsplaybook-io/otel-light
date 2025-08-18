import { Counter, Histogram, ObservableGauge } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  ATTR_NETWORK_LOCAL_ADDRESS,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import * as os from "os";
import { Config } from "../Config";

let meterProvider: MeterProvider;
let config;
const METER_NAME = "default";

//
export function StandardMeterInitTelemetry(initConfig: Config) {
  config = initConfig;

  // Metrics
  if (config.OPENTELEMETRY_COLLECTOR_HTTP_METRICS) {
    const collectorOptions = {
      url: config.OPENTELEMETRY_COLLECTOR_HTTP_METRICS,
      headers: {},
      concurrencyLimit: 1,
    };
    const metricExporter = new OTLPMetricExporter(collectorOptions);
    meterProvider = new MeterProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: `${config.SERVICE_ID}`,
        [ATTR_SERVICE_VERSION]: `${config.VERSION}`,
        [ATTR_NETWORK_LOCAL_ADDRESS]: os.hostname(),
      }),
      readers: [
        new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: 60 * 1000,
        }),
      ],
    });
  } else {
    meterProvider = new MeterProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: `${config.SERVICE_ID}`,
        [ATTR_SERVICE_VERSION]: `${config.VERSION}`,
        [ATTR_NETWORK_LOCAL_ADDRESS]: os.hostname(),
      }),
    });
  }
}

export function StandardMeterCreateCounter(key: string): Counter {
  const meter = meterProvider.getMeter(METER_NAME);
  return meter.createCounter(`${config.SERVICE_ID}.${key}`);
}

export function StandardMeterCreateHistorgram(key: string): Histogram {
  const meter = meterProvider.getMeter(METER_NAME);
  return meter.createHistogram(`${config.SERVICE_ID}.${key}`);
}

export function StandardMeterCreateObservableGauge(
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: (observableResult: any) => void,
  description = null
): ObservableGauge {
  const meter = meterProvider.getMeter(METER_NAME);
  const observableGauge = meter.createObservableGauge(key, description);

  observableGauge.addCallback(callback);

  return observableGauge;
}
