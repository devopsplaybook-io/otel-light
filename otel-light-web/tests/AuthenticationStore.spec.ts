import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { AuthenticationStore } from "../stores/AuthenticationStore";
import { ServicesStore } from "../stores/ServicesStore";

const AUTH_TOKEN_KEY = "auth_token";
const SERVICES_CACHE_KEY = "ServicesStore.cache";

describe("AuthenticationStore.signOut", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("clears the token, the user fields and the services cache", () => {
    localStorage.setItem(AUTH_TOKEN_KEY, "some-token");
    localStorage.setItem(
      SERVICES_CACHE_KEY,
      JSON.stringify({
        services: ["previous-user-service"],
        serviceVersions: [
          { serviceName: "previous-user-service", serviceVersion: "1.0.0" },
        ],
        lastFetchedAt: 123_456,
      }),
    );
    setActivePinia(createPinia());

    const servicesStore = ServicesStore();
    const authStore = AuthenticationStore();
    authStore.isAuthenticated = true;
    authStore.userId = "user-1";
    authStore.userName = "alice";
    authStore.role = "admin";
    authStore.scopes = ["traces", "logs"];

    authStore.signOut();

    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(authStore.isAuthenticated).toBe(false);
    expect(authStore.userId).toBeNull();
    expect(authStore.userName).toBeNull();
    expect(authStore.role).toBeNull();
    expect(authStore.scopes).toEqual([]);
    expect(servicesStore.services).toEqual([]);
    expect(servicesStore.serviceVersions).toEqual([]);
    expect(servicesStore.lastFetchedAt).toBe(0);
    expect(localStorage.getItem(SERVICES_CACHE_KEY)).toBeNull();
  });
});
