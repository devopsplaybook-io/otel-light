import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  axiosPost: vi.fn(),
  getAuthHeader: vi.fn(),
  saveToken: vi.fn(),
  refreshFromToken: vi.fn(),
  clearServices: vi.fn(),
}));

vi.mock("axios", () => ({
  default: { get: mocks.axiosGet, post: mocks.axiosPost },
}));

vi.mock("~~/services/AuthService", () => ({
  AuthService: {
    getAuthHeader: mocks.getAuthHeader,
    saveToken: mocks.saveToken,
  },
}));

vi.mock("~~/stores/AuthenticationStore", () => ({
  AuthenticationStore: () => ({ refreshFromToken: mocks.refreshFromToken }),
}));

vi.mock("~~/stores/ServicesStore", () => ({
  ServicesStore: () => ({ clear: mocks.clearServices }),
}));

import {
  LoginCodeError,
} from "@devopsplaybook.io/common-web/services/LoginCodeService";
import {
  loginCodeService,
  loginCodesAvailable,
  setLoginCodeSessionListener,
} from "../services/LoginCodes";

const { axiosGet, axiosPost, getAuthHeader, saveToken, refreshFromToken, clearServices } =
  mocks;

const capabilitiesBody = {
  enabled: true,
  available: true,
  codeLength: 8,
  rotationSeconds: 30,
  graceSeconds: 60,
  ttlSeconds: 300,
  pollIntervalMs: 2000,
  approveRequiresPassword: false,
  serverTime: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  refreshFromToken.mockResolvedValue(undefined);
  getAuthHeader.mockReturnValue({ headers: { Authorization: "Bearer jwt" } });
});

describe("loginCodeService wiring", () => {
  it("probes capabilities on the app API prefix", async () => {
    axiosGet.mockResolvedValue({ data: capabilitiesBody });

    await expect(loginCodeService.capabilities()).resolves.toMatchObject({
      enabled: true,
      available: true,
    });
    expect(axiosGet).toHaveBeenCalledWith(
      "/api/users/login-codes/capabilities",
      { signal: undefined, timeout: 10000 },
    );
  });

  it("creates a request at the collection route with no body", async () => {
    axiosPost.mockResolvedValue({
      data: {
        requestToken: "request-token",
        code: "BCDFGHJK",
        codeExpiresAt: "2026-01-01T00:00:30.000Z",
        expiresAt: "2026-01-01T00:05:00.000Z",
        serverTime: "2026-01-01T00:00:00.000Z",
      },
    });

    await expect(loginCodeService.create()).resolves.toMatchObject({
      code: "BCDFGHJK",
    });
    expect(axiosPost).toHaveBeenCalledWith(
      "/api/users/login-codes/",
      undefined,
      { signal: undefined, timeout: 10000 },
    );
  });

  it("previews and approves with the interactive session header", async () => {
    axiosPost
      .mockResolvedValueOnce({
        data: {
          deviceLabel: "Chrome",
          userAgent: "Chrome",
          createdAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-01-01T00:05:00.000Z",
          userName: "root",
          serverTime: "2026-01-01T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({ data: { approved: true } });

    await loginCodeService.preview("BCDFGHJK");
    expect(axiosPost).toHaveBeenNthCalledWith(
      1,
      "/api/users/login-codes/preview",
      { code: "BCDFGHJK" },
      {
        signal: undefined,
        timeout: 10000,
        headers: { Authorization: "Bearer jwt" },
      },
    );

    await loginCodeService.approve({ code: "BCDFGHJK" });
    expect(axiosPost).toHaveBeenNthCalledWith(
      2,
      "/api/users/login-codes/approve",
      { code: "BCDFGHJK" },
      {
        signal: undefined,
        timeout: 10000,
        headers: { Authorization: "Bearer jwt" },
      },
    );

    await loginCodeService.approve({ code: "BCDFGHJK", password: "secret" });
    expect(axiosPost).toHaveBeenNthCalledWith(
      3,
      "/api/users/login-codes/approve",
      { code: "BCDFGHJK", password: "secret" },
      expect.anything(),
    );
  });

  it("installs the redeemed session through the password-login bootstrap", async () => {
    axiosPost.mockResolvedValue({
      data: {
        status: "approved",
        token: "session-token",
        user: { id: "u-1", name: "root" },
        expiresAt: "2026-01-31T00:05:00.000Z",
        serverTime: "2026-01-01T00:00:00.000Z",
      },
    });

    await loginCodeService.poll("request-token");

    expect(saveToken).toHaveBeenCalledWith("session-token");
    expect(refreshFromToken).toHaveBeenCalledTimes(1);
    expect(clearServices).toHaveBeenCalledTimes(1);
  });

  it("notifies the page only after the session bootstrap ran", async () => {
    axiosPost.mockResolvedValue({
      data: {
        status: "approved",
        token: "session-token",
        user: { id: "u-1", name: "root" },
        expiresAt: "2026-01-31T00:05:00.000Z",
        serverTime: "2026-01-01T00:00:00.000Z",
      },
    });
    const listener = vi.fn(() => {
      expect(saveToken).toHaveBeenCalledWith("session-token");
      expect(refreshFromToken).toHaveBeenCalledTimes(1);
      expect(clearServices).toHaveBeenCalledTimes(1);
    });
    const unsubscribe = setLoginCodeSessionListener(listener);

    try {
      await loginCodeService.poll("request-token");
    } finally {
      unsubscribe();
    }

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not install a session while the poll is still pending", async () => {
    axiosPost.mockResolvedValue({
      data: {
        status: "pending",
        code: "BCDFGHJK",
        codeExpiresAt: "2026-01-01T00:00:30.000Z",
        expiresAt: "2026-01-01T00:05:00.000Z",
        serverTime: "2026-01-01T00:00:00.000Z",
      },
    });

    await loginCodeService.poll("request-token");

    expect(saveToken).not.toHaveBeenCalled();
    expect(refreshFromToken).not.toHaveBeenCalled();
    expect(clearServices).not.toHaveBeenCalled();
  });

  it("keeps protocol failures typed with their stable code", async () => {
    axiosPost.mockRejectedValue({
      response: { status: 400, data: { code: "INVALID_CODE" } },
    });

    const failure = await loginCodeService
      .preview("AAAAAAAA")
      .catch((error) => error);

    expect(failure).toBeInstanceOf(LoginCodeError);
    expect(failure.code).toBe("INVALID_CODE");
  });
});

describe("loginCodesAvailable", () => {
  it("is true only when the feature is enabled and available", async () => {
    axiosGet.mockResolvedValue({ data: capabilitiesBody });
    await expect(loginCodesAvailable()).resolves.toBe(true);

    axiosGet.mockResolvedValue({ data: { ...capabilitiesBody, enabled: false } });
    await expect(loginCodesAvailable()).resolves.toBe(false);

    axiosGet.mockResolvedValue({
      data: { ...capabilitiesBody, available: false },
    });
    await expect(loginCodesAvailable()).resolves.toBe(false);
  });

  it("fails closed when the probe is rejected (disabled route or network)", async () => {
    axiosGet.mockRejectedValue({
      response: { status: 404, data: {} },
    });
    await expect(loginCodesAvailable()).resolves.toBe(false);
  });
});
