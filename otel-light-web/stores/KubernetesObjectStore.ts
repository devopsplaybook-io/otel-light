import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import axios from "axios";
import { UtilsDecompressData } from "~/services/Utils";

export const KubernetesObjectStore = defineStore("KubernetesObjectStore", {
  state: () => ({
    data: {
      deployments: [],
      statefulsets: [],
      daemonsets: [],
      pods: [],
      jobs: [],
      services: [],
      configmaps: [],
      secrets: [],
      pvcs: [],
    },
    filter: "",
    lastCall: { payload: {}, type: "" },
  }),

  getters: {},

  actions: {
    setFilter(filter: string) {
      this.filter = filter;
      this.refreshLast();
    },
    getPods() {
      this.getObject("pods", {
        object: "pods",
        command: "get",
        argument: "-A",
      });
    },
    getDeployments() {
      this.getObject("deployments", {
        object: "deployments",
        command: "get",
        argument: "-A",
      });
    },
    getServices() {
      this.getObject("services", {
        object: "services",
        command: "get",
        argument: "-A",
      });
    },
    getConfigMaps() {
      this.getObject("configmaps", {
        object: "configmaps",
        command: "get",
        argument: "-A",
      });
    },
    getPVCs() {
      this.getObject("pvcs", { object: "pvc", command: "get", argument: "-A" });
    },
    getSecrets() {
      this.getObject("secrets", {
        object: "secrets",
        command: "get",
        argument: "-A",
      });
    },
    getNodes() {
      this.getObject("nodes", {
        object: "nodes",
        command: "get",
        argument: "",
      });
    },
    getNamespaces() {
      this.getObject("namespaces", {
        object: "namespaces",
        command: "get",
        argument: "",
      });
    },
    getStatefulSets() {
      this.getObject("statefulsets", {
        object: "statefulset",
        command: "get",
        argument: "-A",
      });
    },
    getDaemonSets() {
      this.getObject("daemonsets", {
        object: "daemonset",
        command: "get",
        argument: "-A",
      });
    },
    getJobs() {
      this.getObject("jobs", { object: "job", command: "get", argument: "-A" });
    },
    refreshLast() {
      this.getObject(this.lastCall.type, this.lastCall.payload);
    },
    async getObject(type: string, payload: any) {
      this.lastCall.type = type;
      this.lastCall.payload = payload;
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          payload,
          await AuthService.getAuthHeader()
        )
        .then(async (response) => {
          const items: any[] = [];
          for (const item of JSON.parse(
            await UtilsDecompressData(response.data.result)
          ).items) {
            if (!this.filter.trim()) {
              items.push(item);
              continue;
            }
            const keywords = this.filter
              .toLowerCase()
              .trim()
              .replace(/\s+/g, " ")
              .split(" ");
            const itemString = JSON.stringify(item).trim().toLowerCase();
            if (keywords.every((keyword) => itemString.includes(keyword))) {
              items.push(item);
              continue;
            }
          }
          (this.data as any)[type] = items;
        })
        .catch((error) => {
          console.error(error);
        });
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(KubernetesObjectStore, import.meta.hot)
  );
}
