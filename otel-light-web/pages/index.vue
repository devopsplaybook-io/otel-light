<template>
  <div id="page-intro">
    <NuxtLink to="/traces" class="plain-link">
      <article>
        <header><b>Traces</b></header>
        <section>
          Traces capture the journey of a request as it travels through various
          services and components in a distributed system, helping you visualize
          and analyze end-to-end workflows and pinpoint performance bottlenecks.
        </section>
        <i class="bi bi-list-nested"></i>
      </article>
    </NuxtLink>
    <NuxtLink to="/metrics" class="plain-link">
      <article>
        <header><b>Metrics</b></header>
        <section>
          Metrics provide numerical data about the health and performance of
          your systems, such as request rates, error counts, and resource usage,
          enabling you to monitor trends and set up alerts for anomalies.
        </section>
        <i class="bi bi-bar-chart-line"></i>
      </article>
    </NuxtLink>
    <NuxtLink to="/logs" class="plain-link">
      <article>
        <header><b>Logs</b></header>
        <section>
          Logs record discrete events and messages from your applications,
          offering detailed context for troubleshooting issues, auditing
          activity, and understanding system behavior over time.
        </section>
        <i class="bi bi-card-text"></i>
      </article>
    </NuxtLink>
  </div>
</template>

<script>
export default {
  data() {
    return {};
  },
  async created() {
    if (await AuthenticationStore().ensureAuthenticated()) {
      useRouter().push({ path: "/" });
    } else {
      useRouter().push({ path: "/users" });
    }
  },
};
</script>

<style scoped>
#page-intro {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
  gap: 1rem;
}

.plain-link {
  color: inherit;
  text-decoration: none;
}

#page-intro article {
  display: grid;
  grid-template-columns: 1fr 4rem;
}
#page-intro article header {
  grid-column: 1/3;
}
#page-intro article i {
  font-size: 3rem;
  text-align: right;
}
</style>
