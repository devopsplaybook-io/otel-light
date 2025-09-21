<template>
  <div id="page-layout">
    <header>
      <VitePwaManifest />
      <Navigation />
    </header>
    <main>
      <NuxtPage />
      <AlertMessages id="page-alert-messages" />
    </main>
  </div>
</template>

<script>
export default {};
</script>

<style>
#page-layout {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto 1fr;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden !important;
}

/* Layout */

header {
  height: 3em;
}

header,
main {
  padding: 0.5em;
}

main {
  grid-column: 1;
  grid-row: 2;
  overflow-x: hidden;
  overflow-y: auto;
  width: 100%;
  height: auto;
}

#page-alert-messages {
  position: fixed;
  right: 3rem;
  bottom: 3rem;
  max-width: 80vw;
}

/* Common Component */

.actions i {
  font-size: 1.3em;
  cursor: pointer;
  margin-left: 0.5em;
  margin-right: 0.5em;
}

@media (prefers-color-scheme: dark) {
  .actions i {
    color: #bcc6ce;
  }
}
@media (prefers-color-scheme: light) {
  .actions i {
    color: #1d2832;
  }
}

.fab-button {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  z-index: 1000;
  opacity: 0.3;
  color: #fff;
  border: none;
  border-radius: 2rem;
  padding: 0.5em 1.5em;
  font-size: 1rem;
  box-shadow: 0 2px 8px #0002;
  cursor: pointer;
  transition: background 1s;
  transition: opacity 1s;
}
.fab-button:hover {
  background: #125ea2;
  opacity: 0.9;
}

/* Traces */

.trace-summary,
.trace-span-expanded {
  min-width: 1200px;
}
.trace-summary {
  display: grid;
  grid-template-columns: 3fr 3fr 3fr 2fr 2fr 1fr 1fr;
  gap: 1rem;
  width: 100%;
}
.trace-summary span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trace-summary b {
  cursor: pointer;
  user-select: none;
}
.trace-summary b.asc::after {
  content: " ▲";
  font-size: 0.8em;
}
.trace-summary b.desc::after {
  content: " ▼";
  font-size: 0.8em;
}

/* Dialogs */

dialog article {
  max-width: 90vw;
}
dialog kbd {
  font-size: 0.7em;
  margin-right: 0.5em;
  margin-bottom: 0.5em;
}
dialog pre {
  white-space: pre-wrap;
  word-break: break-all;
}
dialog article {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 1rem;
}
dialog article section {
  overflow-x: auto;
  overflow-y: auto;
  max-height: 70vh;
}
dialog article header {
  font-size: 1.1em;
  font-weight: bold;
}
/* Aninations */

.fade-in-slow {
  animation: fadeIn 2s;
}
.fade-in-fast {
  animation: fadeIn 0.5s;
}
@keyframes fadeIn {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}

.blink {
  transition: all 1s ease-in-out;
  animation: blink normal 3s infinite ease-in-out;
}
@keyframes blink {
  0% {
    color: inherit;
  }
  50% {
    color: #039be5;
  }
  100% {
    color: inherit;
  }
}

/* Loading */

@media (prefers-color-scheme: dark) {
  .loading-indicator {
    --c: no-repeat linear-gradient(#bcc6ce 0 0);
  }
}
@media (prefers-color-scheme: light) {
  .loading-indicator {
    --c: no-repeat linear-gradient(#1d2832 0 0);
  }
}
.loading-indicator {
  width: 15%;
  margin-left: auto;
  margin-right: auto;
  margin-top: 25%;
  aspect-ratio: 1;
  background: var(--c) 0% 50%, var(--c) 50% 50%, var(--c) 100% 50%;
  background-size: 20% 100%;
  animation: l1 2s infinite linear;
}
@keyframes l1 {
  0% {
    background-size: 20% 100%, 20% 100%, 20% 100%;
  }
  33% {
    background-size: 20% 10%, 20% 100%, 20% 100%;
  }
  50% {
    background-size: 20% 100%, 20% 10%, 20% 100%;
  }
  66% {
    background-size: 20% 100%, 20% 100%, 20% 10%;
  }
  100% {
    background-size: 20% 100%, 20% 100%, 20% 100%;
  }
}
</style>
