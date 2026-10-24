import { describe, expect, it } from "vitest";
import MetricDataGauge from "../components/MetricDataGauge.vue";

const gaugeComponent = MetricDataGauge as any;

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
});
