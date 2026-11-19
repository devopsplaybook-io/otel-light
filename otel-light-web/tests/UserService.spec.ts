import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => ({
  default: { post: vi.fn().mockResolvedValue({ data: {} }) },
}));

vi.mock("../services/AuthService", () => ({
  AuthService: {
    getAuthHeader: vi.fn().mockResolvedValue({
      headers: { Authorization: "Bearer test" },
    }),
  },
}));

import axios from "axios";
import { UserService } from "../services/UserService";

const postMock = axios.post as unknown as ReturnType<typeof vi.fn>;

describe("UserService.createApiToken", () => {
  beforeEach(() => {
    postMock.mockClear();
  });

  it("posts the name and expiry date", async () => {
    const expiresAt = "2027-01-01T00:00:00.000Z";
    await UserService.createApiToken("ci", expiresAt);

    expect(postMock).toHaveBeenCalledWith(
      "/api/users/tokens",
      { name: "ci", expiresAt },
      { headers: { Authorization: "Bearer test" } },
    );
  });

  it("omits the expiry when none is supplied", async () => {
    await UserService.createApiToken("ci");

    expect(postMock).toHaveBeenCalledWith(
      "/api/users/tokens",
      { name: "ci" },
      { headers: { Authorization: "Bearer test" } },
    );
  });
});
