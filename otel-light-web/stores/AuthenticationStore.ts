import { AuthService } from "~~/services/AuthService";

export const AuthenticationStore = defineStore("AuthenticationStore", {
  state: () => ({
    isAuthenticated: false,
    userId: null as string | null,
    userName: null as string | null,
    role: null as string | null,
    scopes: [] as string[],
  }),

  getters: {
    isAdmin(): boolean {
      return this.role === "admin";
    },
    hasTracesScope(): boolean {
      return this.isAdmin || this.scopes.includes("traces");
    },
    hasMetricsScope(): boolean {
      return this.isAdmin || this.scopes.includes("metrics");
    },
    hasLogsScope(): boolean {
      return this.isAdmin || this.scopes.includes("logs");
    },
  },

  actions: {
    async ensureAuthenticated(): Promise<boolean> {
      this.isAuthenticated = await AuthService.isAuthenticated();
      if (this.isAuthenticated) {
        const info = await AuthService.getTokenInfo();
        if (info) {
          this.userId = info.userId;
          this.userName = info.userName;
          this.role = info.role;
          this.scopes = info.scopes || [];
        }
      } else {
        this.userId = null;
        this.userName = null;
        this.role = null;
        this.scopes = [];
      }
      return this.isAuthenticated;
    },

    async refreshFromToken(): Promise<void> {
      const info = await AuthService.getTokenInfo();
      if (info) {
        this.userId = info.userId;
        this.userName = info.userName;
        this.role = info.role;
        this.scopes = info.scopes || [];
        this.isAuthenticated = true;
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(AuthenticationStore, import.meta.hot));
}
