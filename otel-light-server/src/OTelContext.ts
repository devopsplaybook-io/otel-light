import {
  StandardLogger,
  StandardMeter,
  StandardTracer,
} from "@devopsplaybook.io/otel-utils";
import { Span } from "@opentelemetry/sdk-trace-base";

let tracer: StandardTracer;
let meter: StandardMeter;
let logger: StandardLogger;

export function OTelSetTracer(tracerIn: StandardTracer) {
  tracer = tracerIn;
}

export function OTelSetMeter(meterIn: StandardMeter) {
  meter = meterIn;
}

export function OTelTracer(): StandardTracer {
  return tracer;
}

export function OTelMeter(): StandardMeter {
  return meter;
}

export function OTelLogger(): StandardLogger {
  if (!logger) {
    logger = new StandardLogger();
  }
  return logger;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function OTelRequestSpan(req: any): Span {
  return req.tracerSpanApi;
}
