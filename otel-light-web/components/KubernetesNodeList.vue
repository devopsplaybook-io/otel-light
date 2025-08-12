<template>
  <div>
    <table class="striped">
      <thead>
        <tr>
          <th>Node</th>
          <th>Status</th>
          <th>Role</th>
          <th>Version</th>
          <th>Memory</th>
          <th>CPU</th>
          <th>Disk</th>
          <th>Age</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="kubeObject of kubernetesObjectStore.data.nodes"
          v-bind:key="kubeObject.metadata.uid"
        >
          <td>{{ kubeObject.metadata.name }}</td>
          <td>{{ getNodeStatus(kubeObject) }}</td>
          <td>{{ getNodeRole(kubeObject) }}</td>
          <td>{{ kubeObject.status.nodeInfo.kubeletVersion }}</td>
          <td>{{ getNodeMemory(kubeObject) }}</td>
          <td>{{ getNodeCPU(kubeObject) }}</td>
          <td>{{ getNodeDisk(kubeObject) }}</td>
          <td>
            {{ UtilsRelativeTime(kubeObject.metadata.creationTimestamp) }}
          </td>
          <td>
            <i
              class="bi bi-file-text-fill"
              v-on:click="showDetails(kubeObject.metadata.name)"
            ></i>
          </td>
        </tr>
      </tbody>
    </table>
    <DialogDetails
      v-if="dialogDetails.enable"
      :text="dialogDetails.text"
      :title="dialogDetails.title"
      @onClose="onCloseDetails()"
    />
  </div>
</template>

<script setup>
import { UtilsRelativeTime } from "~~/services/Utils";
const kubernetesObjectStore = KubernetesObjectStore();
</script>

<script>
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { UtilsDecompressData } from "~/services/Utils";
import axios from "axios";
import Config from "~~/services/Config.ts";

export default {
  data() {
    return {
      dialogDetails: {
        enable: false,
        title: "",
        text: "",
      },
    };
  },
  async created() {
    KubernetesObjectStore().getNodes();
  },
  methods: {
    getNodeMemory(node) {
      const capacity = node.status?.capacity?.memory;
      if (!capacity) return "N/A";
      const memoryGB = this.convertMemoryToGB(capacity);
      return `${memoryGB}GB`;
    },

    convertMemoryToGB(memory) {
      const units = { Ki: 1 / 1024 / 1024, Mi: 1 / 1024, Gi: 1, Ti: 1024 };
      const match = memory.match(/^(\d+)([a-zA-Z]+)$/);
      if (!match) return 0;
      const value = parseInt(match[1], 10);
      const unit = match[2];
      return Math.round(value * (units[unit] || 0));
    },
    getNodeCPU(node) {
      const capacity = node.status?.capacity?.cpu;
      if (!capacity) return "N/A";
      return capacity;
    },
    getNodeDisk(node) {
      const capacity = node.status?.capacity?.["ephemeral-storage"];
      if (!capacity) return "N/A";
      const diskGB = this.convertToGB(capacity);
      return diskGB !== null ? `${diskGB}GB` : "N/A";
    },
    convertToGB(storage) {
      const units = { Ki: 1 / (1024 * 1024), Mi: 1 / 1024, Gi: 1, Ti: 1024 };
      const match = storage.match(/^(\d+)([a-zA-Z]+)$/);
      if (!match) return null;
      const value = parseInt(match[1], 10);
      const unit = match[2];
      const factor = units[unit];
      if (!factor) return null;
      return Math.round(value * factor);
    },
    getNodeRole(node) {
      const labels = node.metadata.labels || {};
      if (
        labels["node-role.kubernetes.io/master"] !== undefined ||
        labels["node-role.kubernetes.io/control-plane"] !== undefined
      ) {
        return "master";
      }
      return "worker";
    },
    getNodeStatus(node) {
      const readyCondition = node.status.conditions?.find(
        (condition) => condition.type === "Ready"
      );
      return readyCondition?.status === "True" ? "Ready" : "NotReady";
    },
    onCloseDetails() {
      this.dialogDetails = {
        enable: false,
        title: "",
        text: "",
      };
    },
    async showDetails(namespace, objectName) {
      this.dialogDetails = {
        enable: true,
        title: "Details",
        text: "",
      };
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          {
            object: "node",
            command: "describe",
            argument: objectName,
            noJson: true,
          },
          await AuthService.getAuthHeader()
        )
        .then(async (res) => {
          this.dialogDetails.text = await UtilsDecompressData(res.data.result);
        })
        .catch(handleError);
    },
  },
};
</script>

<style scoped></style>
