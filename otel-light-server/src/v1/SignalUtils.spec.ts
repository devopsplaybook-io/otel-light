import {
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
  SignalUtilsCheckAuthHeader,
} from "./SignalUtils";
import { SignalUtilsInit } from "./SignalUtils";

// Mock OTelContext to avoid needing real tracer/logger setup
jest.mock("../OTelContext", () => ({
  OTelTracer: () => ({
    startSpan: jest.fn(() => ({
      end: jest.fn(),
      addEvent: jest.fn(),
      setStatus: jest.fn(),
    })),
  }),
  OTelLogger: () => ({
    createModuleLogger: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    })),
  }),
}));

// A minimal Span stub used by SignalUtilsInit
const fakeSpan = {
  end: jest.fn(),
  addEvent: jest.fn(),
  setStatus: jest.fn(),
} as any;

beforeAll(async () => {
  await SignalUtilsInit(fakeSpan, {
    OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "",
  } as any);
});

describe("SignalUtilsGetServiceName", () => {
  it("should return service name from resource attributes", () => {
    const resource = {
      attributes: [
        { key: "service.name", value: { stringValue: "my-service" } },
        { key: "deployment.environment", value: { stringValue: "prod" } },
      ],
    };
    expect(SignalUtilsGetServiceName(resource)).toBe("my-service");
  });

  it("should return 'unknown' when resource has no attributes", () => {
    expect(SignalUtilsGetServiceName({})).toBe("unknown");
  });

  it("should return 'unknown' when service.name attribute is missing", () => {
    const resource = {
      attributes: [
        { key: "deployment.environment", value: { stringValue: "prod" } },
      ],
    };
    expect(SignalUtilsGetServiceName(resource)).toBe("unknown");
  });

  it("should return 'unknown' when resource is null or undefined", () => {
    expect(SignalUtilsGetServiceName(null)).toBe("unknown");
    expect(SignalUtilsGetServiceName(undefined)).toBe("unknown");
  });
});

describe("SignalUtilsGetServiceVersion", () => {
  it("should return service version from resource attributes", () => {
    const resource = {
      attributes: [{ key: "service.version", value: { stringValue: "1.2.3" } }],
    };
    expect(SignalUtilsGetServiceVersion(resource)).toBe("1.2.3");
  });

  it("should return 'unknown' when service.version attribute is missing", () => {
    const resource = {
      attributes: [{ key: "service.name", value: { stringValue: "svc" } }],
    };
    expect(SignalUtilsGetServiceVersion(resource)).toBe("unknown");
  });

  it("should return 'unknown' when resource is null", () => {
    expect(SignalUtilsGetServiceVersion(null)).toBe("unknown");
  });
});

describe("SignalUtilsCheckAuthHeader", () => {
  it("should pass when no auth header is configured", async () => {
    // OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER is "" from beforeAll
    const req = { headers: {} };
    expect(SignalUtilsCheckAuthHeader(req)).toBe(true);
  });

  it("should reject when configured but request has no auth header", async () => {
    await SignalUtilsInit(fakeSpan, {
      OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "my-secret",
    } as any);

    const req = { headers: {} };
    expect(SignalUtilsCheckAuthHeader(req)).toBe(false);
  });

  it("should reject when request auth header does not match", async () => {
    await SignalUtilsInit(fakeSpan, {
      OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "my-secret",
    } as any);

    const req = { headers: { authorization: "Bearer wrong-secret" } };
    expect(SignalUtilsCheckAuthHeader(req)).toBe(false);
  });

  it("should pass when request auth header matches", async () => {
    await SignalUtilsInit(fakeSpan, {
      OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "my-secret",
    } as any);

    const req = { headers: { authorization: "Bearer my-secret" } };
    expect(SignalUtilsCheckAuthHeader(req)).toBe(true);
  });

  it("should handle missing 'Bearer ' prefix", async () => {
    await SignalUtilsInit(fakeSpan, {
      OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "my-secret",
    } as any);

    const req = { headers: { authorization: "my-secret" } };
    expect(SignalUtilsCheckAuthHeader(req)).toBe(true);
  });

  afterAll(async () => {
    // Reset config to no auth for other test groups
    await SignalUtilsInit(fakeSpan, {
      OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "",
    } as any);
  });
});
