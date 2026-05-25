import { SERVER_URL } from "~~/services/Config";
import { AuthService } from "~~/services/AuthService";
import { analyticsFetch } from "~~/services/AnalyticsQueue";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = "ServicesStore.cache";
const CACHE_MAX_AGE_MS = 5 * 60 * 1000; // consider stale after 5 minutes

function loadCache(): {
  services: string[];
  serviceVersions: ServiceVersionEntry[];
  lastFetchedAt: number;
} {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { services: [], serviceVersions: [], lastFetchedAt: 0 };
}

function saveCache(
  services: string[],
  serviceVersions: ServiceVersionEntry[],
  lastFetchedAt: number,
): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ services, serviceVersions, lastFetchedAt }),
    );
  } catch {
    // ignore
  }
}

export interface ServiceVersionEntry {
  serviceName: string;
  serviceVersion: string | null;
}

export const ServicesStore = defineStore("ServicesStore", {
  state: () => {
    const cache = loadCache();
    return {
      services: cache.services,
      serviceVersions: cache.serviceVersions,
      lastFetchedAt: cache.lastFetchedAt,
      _intervalId: null as ReturnType<typeof setInterval> | null,
    };
  },

  getters: {
    versionsForService:
      (state) =>
      (serviceName: string): string[] => {
        return state.serviceVersions
          .filter(
            (sv) =>
              sv.serviceName === serviceName && sv.serviceVersion !== null,
          )
          .map((sv) => sv.serviceVersion as string);
      },
  },

  actions: {
    async fetchServices(): Promise<void> {
      try {
        const authHeader = await AuthService.getAuthHeader();
        const response = await analyticsFetch(`${SERVER_URL}/analytics/services`, {
          ...authHeader,
        });
        if (response.ok) {
          const data = await response.json();
          this.services = data.services || [];
          this.serviceVersions = data.serviceVersions || [];
          this.lastFetchedAt = Date.now();
          saveCache(this.services, this.serviceVersions, this.lastFetchedAt);
        }
      } catch {
        // silently ignore
      }
    },

    startAutoRefresh(): void {
      if (this._intervalId) return;
      // Only fetch from network if cache is stale or empty
      const age = Date.now() - this.lastFetchedAt;
      if (age > CACHE_MAX_AGE_MS || this.services.length === 0) {
        this.fetchServices();
      }
      this._intervalId = setInterval(() => {
        this.fetchServices();
      }, REFRESH_INTERVAL_MS);
    },

    stopAutoRefresh(): void {
      if (this._intervalId) {
        clearInterval(this._intervalId);
        this._intervalId = null;
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(ServicesStore, import.meta.hot));
}
