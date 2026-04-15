import Config from "~~/services/Config";
import { AuthService } from "~~/services/AuthService";

const REFRESH_INTERVAL_MS = 60 * 1000; // 1 minute

export const ServicesStore = defineStore("ServicesStore", {
  state: () => ({
    services: [] as string[],
    lastFetchedAt: 0,
    _intervalId: null as ReturnType<typeof setInterval> | null,
  }),

  getters: {},

  actions: {
    async fetchServices(): Promise<void> {
      try {
        const config = await Config.get();
        const authHeader = await AuthService.getAuthHeader();
        const response = await fetch(
          `${config.SERVER_URL}/analytics/services`,
          {
            ...authHeader,
          },
        );
        if (response.ok) {
          const data = await response.json();
          this.services = data.services || [];
          this.lastFetchedAt = Date.now();
        }
      } catch {
        // silently ignore
      }
    },

    startAutoRefresh(): void {
      if (this._intervalId) return;
      this.fetchServices();
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
