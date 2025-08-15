import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import axios from "axios";

export const TracesStore = defineStore("TracesStore", {
  state: () => ({
    data: {
      traces: [],
    },
  }),

  getters: {},

  actions: {
    async getTraces() {
      axios
        .get(
          `${(await Config.get()).SERVER_URL}/analytics/traces`,
          await AuthService.getAuthHeader()
        )
        .then((response) => {
          this.traces = response.data.traces;
        });
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(TracesStore, import.meta.hot));
}
