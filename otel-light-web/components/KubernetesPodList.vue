<template>
  <div>
    <table class="striped">
      <thead>
        <tr>
          <th>Namespace</th>
          <th>Pod</th>
          <th>Status</th>
          <th>Age</th>
          <th>Ready</th>
          <th>Details</th>
          <th>Logs</th>
          <th>Delete</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="kubeObject of kubernetesObjectStore.data.pods"
          v-bind:key="kubeObject.metadata.uuid"
        >
          <td>{{ kubeObject.metadata.namespace }}</td>
          <td>{{ kubeObject.metadata.name }}</td>
          <td>{{ kubeObject.status.phase }}</td>
          <td>
            {{ UtilsRelativeTime(kubeObject.metadata.creationTimestamp) }}
          </td>
          <td>
            {{
              (() => {
                const statuses = kubeObject.status?.containerStatuses || [];
                const readyCount = statuses.filter((s) => s.ready).length;
                const totalCount = statuses.length;
                return `${readyCount}/${totalCount}`;
              })()
            }}
          </td>
          <td>
            <i
              class="bi bi-file-text-fill"
              v-on:click="
                showDetails(
                  kubeObject.metadata.namespace,
                  kubeObject.metadata.name
                )
              "
            ></i>
          </td>
          <td>
            <i
              class="bi bi-file-text-fill"
              v-on:click="
                showLogs(
                  kubeObject.metadata.namespace,
                  kubeObject.metadata.name
                )
              "
            ></i>
          </td>
          <td>
            <i
              class="bi bi-x-circle-fill"
              v-on:click="
                podDelete(
                  kubeObject.metadata.namespace,
                  kubeObject.metadata.name
                )
              "
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
    <DialogLogs
      v-if="dialogLogs.enable"
      :podname="dialogLogs.podname"
      :namespace="dialogLogs.namespace"
      :title="dialogLogs.title"
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
      dialogLogs: {
        enable: false,
        podname: "",
        namespace: "",
      },
    };
  },
  async created() {
    KubernetesObjectStore().getPods();
  },
  methods: {
    async podDelete(namespace, podname) {
      if (!confirm(`Delete pod ${podname} (${namespace})`)) {
        return;
      }
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          {
            namespace,
            object: "pods",
            command: "delete",
            argument: podname,
            noJson: true,
          },
          await AuthService.getAuthHeader()
        )
        .then(() => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: "Pod Deleted",
          });
          setTimeout(() => {
            KubernetesObjectStore().getPods();
          }, 1000);
        })
        .catch(handleError);
    },
    onCloseDetails() {
      this.dialogDetails = {
        enable: false,
        title: "",
        text: "",
      };
      this.dialogLogs = {
        enable: false,
        podname: "",
        namespace: "",
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
            namespace,
            object: "pod",
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
    async showLogs(namespace, podname) {
      this.dialogLogs = {
        enable: true,
        podname,
        namespace,
      };
    },
  },
};
</script>

<style scoped></style>
