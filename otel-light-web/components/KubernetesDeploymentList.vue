<template>
  <div>
    <table class="striped">
      <thead>
        <tr>
          <th>Namespace</th>
          <th>Deployemt</th>
          <th>Ready</th>
          <th>Age</th>
          <th>Details</th>
          <th>Restart</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="kubeObject of kubernetesObjectStore.data.deployments"
          v-bind:key="kubeObject.metadata.uid"
        >
          <td>{{ kubeObject.metadata.namespace }}</td>
          <td>{{ kubeObject.metadata.name }}</td>
          <td>
            {{ kubeObject.status.readyReplicas }}/{{
              kubeObject.status.replicas
            }}
          </td>
          <td>
            {{ UtilsRelativeTime(kubeObject.metadata.creationTimestamp) }}
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
              class="bi bi-arrow-clockwise"
              v-on:click="
                deploymentRestart(
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
    KubernetesObjectStore().getDeployments();
  },
  methods: {
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
            namespace,
            object: "deployment",
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
    async deploymentRestart(namespace, deploymentName) {
      if (
        !confirm(
          `Perform a rollout restart of deployment ${deploymentName} (${namespace})`
        )
      ) {
        return;
      }
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/command`,
          {
            namespace,
            object: "deployment",
            command: "rollout restart",
            argument: deploymentName,
            noJson: true,
          },
          await AuthService.getAuthHeader()
        )
        .then(() => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: "Rollout Restart Started",
          });
          setTimeout(() => {
            KubernetesObjectStore().getDeployments();
          }, 1000);
        })
        .catch(handleError);
    },
  },
};
</script>

<style scoped></style>
