import { describe, expect, it, vi } from "vitest";
import MetricDataGauge from "../components/MetricDataGauge.vue";

vi.mock("../services/MetricsService", () => ({
  MetricsServiceFetchMetricData: vi.fn(),
}));

import { MetricsServiceFetchMetricData } from "../services/MetricsService";

const fetchMetricData = MetricsServiceFetchMetricData as unknown as ReturnType<
  typeof vi.fn
>;

const gaugeComponent = MetricDataGauge as any;

function fetchContext(createEmits: string[][]) {
  return {
    serviceName: "svc",
    name: "metric",
    filter: { queryString: "" },
    loading: false,
    chartSeries: [],
    allMetrics: [],
    metrics: [],
    priority: false,
    fetchTime: null,
    displayMetrics: () => {},
    $emit: (event: string, payload: string) => createEmits.push([event, payload]),
  };
}

describe("MetricDataGauge", () => {
  it("configures the legend inside chart options", () => {
    const data = gaugeComponent.data();
    expect(data.chartOptions.legend).toEqual({ height: 80 });
    expect(data.legend).toBeUndefined();
  });

  it("renders integer values and sorts points by time", () => {
    const context = {
      chartSeries: [],
      metrics: [
        {
          data: {
            gauge: {
              dataPoints: [
                { timeUnixNano: "3000000000", asDouble: 1.5, attributes: [] },
                { timeUnixNano: "1000000000", asInt: 7, attributes: [] },
              ],
            },
          },
        },
      ],
    };

    gaugeComponent.methods.displayMetrics.call(context);

    expect(context.chartSeries).toHaveLength(1);
    const series = context.chartSeries[0];
    expect(series.name).toBe("default");
    expect(
      series.data.map(([time, value]: [Date, number]) => [time.getTime(), value]),
    ).toEqual([
      [1000, 7],
      [3000, 1.5],
    ]);
  });

  it("emits queued, loading (on slot start) and loaded around the request", async () => {
    fetchMetricData.mockImplementation(
      (_service: string, _name: string, _qs: string, options: any) => {
        options.onStart();
        return Promise.resolve([]);
      },
    );
    const emitted: string[][] = [];
    const context = fetchContext(emitted);

    await gaugeComponent.methods.fetchMetrics.call(context);

    expect(
      emitted
        .filter(([event]) => event === "loadState")
        .map(([, payload]) => payload),
    ).toEqual(["queued", "loading", "loaded"]);
    const options = fetchMetricData.mock.calls[0][3];
    expect(options.priority).toBe(false);
    expect(typeof options.onStart).toBe("function");
    expect(context.loading).toBe(false);
  });

  it("emits error when the request fails", async () => {
    fetchMetricData.mockImplementation(() => Promise.reject(new Error("boom")));
    const emitted: string[][] = [];
    const context = fetchContext(emitted);

    await gaugeComponent.methods.fetchMetrics.call(context);

    expect(
      emitted
        .filter(([event]) => event === "loadState")
        .map(([, payload]) => payload),
    ).toEqual(["queued", "error"]);
  });
});
