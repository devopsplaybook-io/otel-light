import {
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "./SignalUtils";

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
      attributes: [
        { key: "service.version", value: { stringValue: "1.2.3" } },
      ],
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
