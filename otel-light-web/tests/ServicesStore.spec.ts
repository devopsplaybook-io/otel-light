import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ServicesStore } from "../stores/ServicesStore";

const CACHE_KEY = "ServicesStore.cache";

describe("ServicesStore", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("hydrates state from the persisted cache", () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        services: ["checkout"],
        serviceVersions: [
          { serviceName: "checkout", serviceVersion: "2.0.0" },
        ],
        lastFetchedAt: 123_456,
      }),
    );
    setActivePinia(createPinia());

    const store = ServicesStore();

    expect(store.services).toEqual(["checkout"]);
    expect(store.serviceVersions).toEqual([
      { serviceName: "checkout", serviceVersion: "2.0.0" },
    ]);
    expect(store.lastFetchedAt).toBe(123_456);
  });

  it("clear() empties the state, removes the cache and stops refreshing", () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        services: ["checkout"],
        serviceVersions: [
          { serviceName: "checkout", serviceVersion: "2.0.0" },
        ],
        lastFetchedAt: 123_456,
      }),
    );
    setActivePinia(createPinia());
    const store = ServicesStore();
    store._intervalId = setInterval(() => {}, 60_000);

    store.clear();

    expect(store.services).toEqual([]);
    expect(store.serviceVersions).toEqual([]);
    expect(store.lastFetchedAt).toBe(0);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(store._intervalId).toBeNull();
  });
});
