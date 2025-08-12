<template>
  <div id="object-layout">
    <input
      id="object-search"
      type="search"
      v-model="searchFilter"
      placeholder="Search"
      aria-label="Search"
      v-on:input="filterChanged"
    />
    <div id="object-actions" class="actions">
      <select v-model="objectType">
        <option value="node">Nodes</option>
        <option value="namespace">Namespaces</option>
        <option value="deployment">Deployments</option>
        <option value="statefulset">StatefulSets</option>
        <option value="daemonset">DaemonSets</option>
        <option value="pod">Pods</option>
        <option value="job">Jobs</option>
        <option value="service">Services</option>
        <option value="pvc">PVC</option>
        <option value="configmap">ConfigMap</option>
        <option value="secret">Secrets</option>
      </select>
      <span
        ><i class="bi bi-arrow-clockwise" v-on:click="refreshObject()"></i
      ></span>
    </div>
    <div id="object-list">
      <KubernetesNodeList v-if="objectType == 'node'" />
      <KubernetesNamespaceList v-if="objectType == 'namespace'" />
      <KubernetesDeploymentList v-if="objectType == 'deployment'" />
      <KubernetesPodList v-else-if="objectType == 'pod'" />
      <KubernetesStatefulSetList v-else-if="objectType == 'statefulset'" />
      <KubernetesDaemonSetList v-else-if="objectType == 'daemonset'" />
      <KubernetesJobList v-else-if="objectType == 'job'" />
      <KubernetesServiceList v-else-if="objectType == 'service'" />
      <KubernetesPVCList v-else-if="objectType == 'pvc'" />
      <KubernetesConfigMapList v-else-if="objectType == 'configmap'" />
      <KubernetesSecretList v-else-if="objectType == 'secret'" />
    </div>
  </div>
</template>

<script>
import { debounce } from "lodash";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";

export default {
  data() {
    return {
      objectType: "pod",
      searchFilter: "",
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    const route = useRoute();
    if (route.query.objectType) {
      this.objectType = route.query.objectType;
    }
    if (route.query.search) {
      this.searchFilter = route.query.search;
      KubernetesObjectStore().setFilter(this.searchFilter);
    }
    this.refreshIntervalValue = RefreshIntervalService.get();
  },
  mounted() {
    const interval = parseInt(this.refreshIntervalValue, 10);
    if (interval > 0) {
      this.refreshIntervalId = setInterval(() => {
        this.refreshObject();
      }, interval);
    }
  },
  beforeUnmount() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
  },
  watch: {
    objectType(newType) {
      const router = useRouter();
      const route = useRoute();
      router.replace({
        path: route.path,
        query: {
          ...route.query,
          objectType: newType,
          ...(this.searchFilter ? { search: this.searchFilter } : {}),
        },
      });
    },
    searchFilter(newFilter) {
      const router = useRouter();
      const route = useRoute();
      const query = { ...route.query, objectType: this.objectType };
      if (newFilter) {
        query.search = newFilter;
      } else {
        delete query.search;
      }
      router.replace({
        path: route.path,
        query,
      });
    },
  },
  methods: {
    refreshObject() {
      KubernetesObjectStore().refreshLast();
    },
    filterChanged: debounce(async function (e) {
      KubernetesObjectStore().setFilter(this.searchFilter);
    }, 500),
  },
};
</script>

<style>
select {
  padding: 0.5em 1em;
  height: 2.6rem;
}
#object-layout {
  display: grid;
  max-height: 100%;
  height: auto;
  grid-template-rows: auto auto 1fr;
}
#object-actions {
  display: grid;
  grid-template-columns: 1fr auto;
}
#object-actions span {
  padding-top: 0.3rem;
}
#object-search {
  padding-top: 0.5em;
  padding-bottom: 0.5em;
  padding-left: 3em;
  height: 2.6rem;
}

#object-list {
  overflow-x: auto;
  overflow-y: auto;
  height: 100%;
  width: 100%;
}
#object-list td {
  white-space: nowrap;
}

#object-list td,
#object-list pre,
#object-list div,
#object-list span,
#object-list p {
  font-size: 0.9em;
}
</style>
