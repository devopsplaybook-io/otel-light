import { createApp } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AlertMessages from "../components/AlertMessages.vue";
import { EventBus, EventTypes } from "../services/EventBus";

function emitAlert(text: string): void {
  EventBus.emit(EventTypes.ALERT_MESSAGE, { type: "info", text });
}

describe("AlertMessages", () => {
  let app: any = null;
  let vm: any = null;

  beforeEach(() => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    app = createApp(AlertMessages);
    app.mount(container);
    vm = (app._instance as any).proxy;
  });

  afterEach(() => {
    if (app) {
      app.unmount();
      app = null;
    }
    EventBus.all.delete(EventTypes.ALERT_MESSAGE);
    vi.useRealTimers();
  });

  it("keeps duplicate texts queued and dismisses messages in emission order", async () => {
    emitAlert("same message");
    await vi.advanceTimersByTimeAsync(1000);
    emitAlert("same message");

    expect(vm.messages).toHaveLength(2);
    expect(vm.messages[0].id).not.toBe(vm.messages[1].id);

    await vi.advanceTimersByTimeAsync(4000);
    expect(vm.messages).toHaveLength(1);
    expect(vm.messages[0].id).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(vm.messages).toHaveLength(0);
  });

  it("removes its listener and pending timers on unmount", async () => {
    emitAlert("first");
    expect(vm.messages).toHaveLength(1);

    app!.unmount();
    app = null;

    emitAlert("after unmount");
    await vi.advanceTimersByTimeAsync(6000);

    expect(vm.messages).toHaveLength(1);
    expect(EventBus.all.get(EventTypes.ALERT_MESSAGE) ?? []).toHaveLength(0);
  });
});
