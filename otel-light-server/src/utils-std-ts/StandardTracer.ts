import opentelemetry, {
  defaultTextMapGetter,
  defaultTextMapSetter,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AWSXRayIdGenerator } from "@opentelemetry/id-generator-aws-xray";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { api } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  Span,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_NETWORK_LOCAL_ADDRESS,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { FastifyInstance } from "fastify";
import * as os from "os";
import { Config } from "../Config";
import { Logger } from "./Logger";

let tracerInstance;
const propagator = new W3CTraceContextPropagator();
const logger = new Logger("StandardTracerApi");
let meterProvider;
let config;

//
export function StandardTracerInitTelemetry(initConfig: Config) {
  config = initConfig;
  const spanProcessors = [];
  if (config.OPENTELEMETRY_COLLECTOR_HTTP) {
    const exporter = new OTLPTraceExporter({
      url: config.OPENTELEMETRY_COLLECTOR_HTTP,
      headers: {},
    });
    spanProcessors.push(new BatchSpanProcessor(exporter));
  }
  if (config.OPENTELEMETRY_COLLECTOR_CONSOLE) {
    const exporter = new CustomConsoleSpanExporter();
    spanProcessors.push(new BatchSpanProcessor(exporter));
  }
  const provider = new NodeTracerProvider({
    idGenerator: new AWSXRayIdGenerator(),
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: `${config.SERVICE_ID}`,
      [ATTR_SERVICE_VERSION]: `${config.VERSION}`,
      [ATTR_NETWORK_LOCAL_ADDRESS]: os.hostname(),
    }),
    spanProcessors,
  });
  provider.register();
  const contextManager = new AsyncHooksContextManager();
  contextManager.enable();
  opentelemetry.context.setGlobalContextManager(contextManager);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function StandardTracerGetSpanFromRequest(req: any): Span {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (req as any).tracerSpanApi as Span;
}

export function StandardTracerStartSpan(name, parentSpan?: Span): Span {
  const tracer = StandardTracerGetTracer();

  if (parentSpan) {
    return tracer.startSpan(
      name,
      undefined,
      opentelemetry.trace.setSpan(opentelemetry.context.active(), parentSpan)
    ) as Span;
  }

  const span = tracer.startSpan(name) as Span;
  span.setAttribute(ATTR_HTTP_REQUEST_METHOD, `BACKEND`);
  span.setAttribute(
    ATTR_HTTP_ROUTE,
    `${config.SERVICE_ID}-${config.VERSION}-${name}`
  );
  span.setAttribute(
    ATTR_SERVICE_NAME,
    `${config.SERVICE_ID}-${config.VERSION}`
  );

  return span;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function StandardTracerGetTracer(): any {
  if (!tracerInstance) {
    tracerInstance = opentelemetry.trace.getTracer(
      `${config.SERVICE_ID}-${config.VERSION}`
    );
  }
  return tracerInstance;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function StandardTracerAppendHeader(context: Span, headers = {}): any {
  if (!headers) {
    headers = {};
  }
  propagator.inject(
    trace.setSpanContext(ROOT_CONTEXT, context.spanContext()),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    headers as any,
    defaultTextMapSetter
  );
  return headers;
}

export function StandardTracerInitFastify(fastify: FastifyInstance) {
  fastify.addHook("onRequest", async (req) => {
    let spanName = `${req.method}-${req.url}`;
    let urlName = req.url;
    if (config.OPENTELEMETRY_COLLECTOR_AWS) {
      spanName = `${config.SERVICE_ID}-${config.VERSION}`;
      urlName = `${config.SERVICE_ID}-${config.VERSION}-${req.method}-${req.url}`;
    }
    const callerContext = propagator.extract(
      ROOT_CONTEXT,
      req.headers,
      defaultTextMapGetter
    );
    api.context.with(callerContext, () => {
      const span = StandardTracerStartSpan(spanName);
      span.setAttribute(ATTR_HTTP_REQUEST_METHOD, req.method);
      span.setAttribute(ATTR_HTTP_ROUTE, urlName);
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (req as any).tracerSpanApi = span;
    });
  });

  fastify.addHook("onResponse", async (req, reply) => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const span = (req as any).tracerSpanApi as Span;
    if (reply.statusCode > 299) {
      span.status.code = SpanStatusCode.ERROR;
    } else {
      span.status.code = SpanStatusCode.OK;
    }
    span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, reply.statusCode);
    span.end();
  });

  fastify.addHook("onError", async (req, reply, error) => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const span = (req as any).tracerSpanApi as Span;
    span.status.code = SpanStatusCode.ERROR;
    span.recordException(error);
    logger.error(error);
  });
}

export function StandardTracerMetricAdd(key: string, value = 1): void {
  const meter = meterProvider.getMeter("default");
  const counter = meter.createCounter(`${config.SERVICE_ID}-${key}`);
  counter.add(value, { key: "value" });
  logger.info(`+ Metric: ${config.SERVICE_ID}-${key}: ${value}`);
}

class CustomConsoleSpanExporter extends ConsoleSpanExporter {
  export(spans, resultCallback) {
    spans.forEach((span) => {
      const {
        _spanContext,
        parentSpanContext,
        name,
        attributes,
        status,
        duration,
      } = span;
      console.log(
        `${parentSpanContext ? parentSpanContext.spanId + " > " : ""}${
          _spanContext.spanId
        } ${name}` +
          ` ${
            attributes && Object.keys(attributes).length > 0
              ? JSON.stringify(attributes) + " "
              : ""
          }` +
          `${status.code === 0 ? "OK" : "ERROR"} ${duration}ns`
      );
    });
    resultCallback({ code: 0 });
  }
}

class NoSpanExporter extends ConsoleSpanExporter {
  export(spans, resultCallback) {
    resultCallback({ code: 0 });
  }
}
