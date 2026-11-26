import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isInitialized: vi.fn(),
  isAuthenticated: vi.fn(),
  refreshFromToken: vi.fn(),
  listApiTokens: vi.fn(),
  loginCodesAvailable: vi.fn(),
  setLoginCodeSessionListener: vi.fn(),
  emit: vi.fn(),
  push: vi.fn(),
}));

vi.mock("~~/services/UserService", () => ({
  UserService: {
    isInitialized: mocks.isInitialized,
    listApiTokens: mocks.listApiTokens,
    register: vi.fn(),
    login: vi.fn(),
    createApiToken: vi.fn(),
    deleteApiToken: vi.fn(),
  },
}));

vi.mock("~~/services/AuthService", () => ({
  AuthService: {
    isAuthenticated: mocks.isAuthenticated,
    refreshFromToken: mocks.refreshFromToken,
    getAuthHeader: vi.fn().mockReturnValue({}),
    saveToken: vi.fn(),
    removeToken: vi.fn(),
  },
}));

vi.mock("~~/services/LoginCodes", () => ({
  loginCodeService: { capabilities: vi.fn() },
  loginCodesAvailable: mocks.loginCodesAvailable,
  setLoginCodeSessionListener: mocks.setLoginCodeSessionListener,
}));

vi.mock("~~/services/EventBus", () => ({
  EventBus: { emit: mocks.emit },
  EventTypes: { ALERT_MESSAGE: "ALERT_MESSAGE" },
  handleError: vi.fn(),
}));

vi.mock("axios", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock("@devopsplaybook.io/common-web/components/LoginWithCodeCard.vue", async () => {
  const { h } = await import("vue");
  return {
    default: {
      name: "LoginWithCodeCard",
      props: ["service", "variant", "headingLevel"],
      render: () => h("div", { class: "login-with-code-stub" }),
    },
  };
});

vi.mock(
  "@devopsplaybook.io/common-web/components/AuthorizeDeviceCard.vue",
  async () => {
    const { h } = await import("vue");
    return {
      default: {
        name: "AuthorizeDeviceCard",
        props: ["service", "variant", "headingLevel", "labels"],
        render: () => h("div", { class: "authorize-device-stub" }),
      },
    };
  },
);

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import ProfilePage from "../pages/settings/profile.vue";

const store = reactive({
  isAuthenticated: false,
  userName: "root",
  isAdmin: false,
  refreshFromToken: mocks.refreshFromToken,
  signOut: vi.fn(),
});

let wrapper: VueWrapper | undefined;

async function mountPage() {
  wrapper = mount(ProfilePage, {
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  store.isAuthenticated = false;
  mocks.isInitialized.mockResolvedValue(true);
  mocks.isAuthenticated.mockResolvedValue(false);
  mocks.loginCodesAvailable.mockResolvedValue(false);
  mocks.setLoginCodeSessionListener.mockReturnValue(() => {});
  mocks.listApiTokens.mockResolvedValue({ data: [] });
  mocks.refreshFromToken.mockResolvedValue(undefined);
  (globalThis as any).AuthenticationStore = () => store;
  (globalThis as any).useRouter = () => ({ push: mocks.push });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

describe("Profile page login-code wiring", () => {
  it("offers the code login below the password form when available", async () => {
    mocks.loginCodesAvailable.mockResolvedValue(true);

    const page = await mountPage();

    expect(page.find(".login-with-code-stub").exists()).toBe(true);
    expect(page.text()).toContain("Sign In");
  });

  it("keeps the password-only form when the feature is unavailable", async () => {
    const page = await mountPage();

    expect(page.find(".login-with-code-stub").exists()).toBe(false);
    expect(page.text()).toContain("Sign In");
  });

  it("offers the device approval card to an authenticated user", async () => {
    mocks.loginCodesAvailable.mockResolvedValue(true);
    mocks.isAuthenticated.mockResolvedValue(true);

    const page = await mountPage();

    expect(page.find(".authorize-device-stub").exists()).toBe(true);
  });

  it("hides the device approval card when the feature is unavailable", async () => {
    mocks.isAuthenticated.mockResolvedValue(true);

    const page = await mountPage();

    expect(page.find(".authorize-device-stub").exists()).toBe(false);
    expect(page.text()).toContain("Account");
  });

  it("mirrors the password login alerts and redirect after a code approval", async () => {
    mocks.loginCodesAvailable.mockResolvedValue(true);
    const page = await mountPage();

    (page.vm as any).onCodeLoginApproved();

    expect(mocks.emit).toHaveBeenCalledWith("ALERT_MESSAGE", {
      type: "info",
      text: "User Logged In",
    });
    expect(mocks.push).toHaveBeenCalledWith({ path: "/" });
  });

  it("redirects when the service reports the redeemed session", async () => {
    mocks.loginCodesAvailable.mockResolvedValue(true);
    await mountPage();

    const listener = mocks.setLoginCodeSessionListener.mock.calls.at(-1)?.[0];
    expect(typeof listener).toBe("function");
    listener();

    expect(mocks.emit).toHaveBeenCalledWith("ALERT_MESSAGE", {
      type: "info",
      text: "User Logged In",
    });
    expect(mocks.push).toHaveBeenCalledWith({ path: "/" });
  });

  it("falls back to the password form when the user prefers it", async () => {
    mocks.loginCodesAvailable.mockResolvedValue(true);
    const page = await mountPage();
    expect(page.find(".login-with-code-stub").exists()).toBe(true);

    (page.vm as any).hideLoginCode();
    await flushPromises();

    expect(page.find(".login-with-code-stub").exists()).toBe(false);
  });
});
