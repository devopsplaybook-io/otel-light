import { describe, expect, it } from "vitest";
import {
  RecommendationBuildTraceLinks,
  RecommendationTraceQuery,
} from "../services/RecommendationLinks";

const recommendation = {
  generatedAt: "2026-11-18T00:00:00.000Z",
  stats: {
    periodHours: 24,
    periodStart: (Date.parse("2026-11-17T00:00:00.000Z") * 1_000_000) as any,
    periodEnd: (Date.parse("2026-11-18T00:00:00.000Z") * 1_000_000) as any,
    traces: {
      topByErrors: [
        { serviceName: "api", name: "GET /checkout", count: 12, errorCount: 7 },
        { serviceName: "api", name: "GET /checkout", count: 12, errorCount: 7 },
      ],
      topByCount: [
        { serviceName: "api", name: "GET /checkout", count: 12, errorCount: 7 },
        { serviceName: "worker", name: "job.run", count: 40, errorCount: 0 },
      ],
    },
  },
};

describe("RecommendationBuildTraceLinks", () => {
  it("dedupes entries and lists error entries before count entries", () => {
    const links = RecommendationBuildTraceLinks(recommendation);
    expect(links.map((link) => link.key)).toEqual([
      "api::GET /checkout",
      "worker::job.run",
    ]);
    expect(links[0]).toMatchObject({
      serviceName: "api",
      name: "GET /checkout",
      label: "api: GET /checkout",
      count: 12,
      errorCount: 7,
      meta: "12 traces · 7 errors",
    });
    expect(links[1].meta).toBe("40 traces");
  });

  it("caps the number of links", () => {
    const many = {
      stats: {
        traces: {
          topByCount: Array.from({ length: 20 }, (_, index) => ({
            serviceName: "svc",
            name: `op-${index}`,
            count: index,
          })),
        },
      },
    };
    expect(RecommendationBuildTraceLinks(many, 3)).toHaveLength(3);
  });

  it("skips entries without a name and handles a missing payload", () => {
    expect(RecommendationBuildTraceLinks(null)).toEqual([]);
    expect(
      RecommendationBuildTraceLinks({
        stats: { traces: { topByCount: [{ serviceName: "svc" }] } },
      })
    ).toEqual([]);
  });

  it("labels groups without a service by name only", () => {
    const links = RecommendationBuildTraceLinks({
      stats: { traces: { topByCount: [{ name: "cron", count: 2 }] } },
    });
    expect(links[0]).toMatchObject({
      serviceName: null,
      label: "cron",
      meta: "2 traces",
    });
  });
});

describe("RecommendationTraceQuery", () => {
  const nowMs = Date.parse("2026-11-18T00:05:00.000Z");

  it("points to the exact trace name within the recommendation window", () => {
    const [link] = RecommendationBuildTraceLinks(recommendation);
    // The window starts 24h+5min ago, so the 2 days option covers it.
    expect(RecommendationTraceQuery(link, recommendation, nowMs)).toEqual({
      serviceName: "api",
      name: "GET /checkout",
      from: String(2 * 24 * 60 * 60),
      to: "0",
    });
  });

  it("falls back to generatedAt and periodHours when bounds are missing", () => {
    const rec = {
      generatedAt: "2026-11-18T00:00:00.000Z",
      stats: { periodHours: 6 },
    };
    // generatedAt is 5 min before now and the period is 6 h: 6h5m elapsed.
    expect(
      RecommendationTraceQuery(
        { key: "k", serviceName: "api", name: "op", count: 1, errorCount: 0, label: "", meta: "" },
        rec,
        nowMs
      )
    ).toEqual({
      serviceName: "api",
      name: "op",
      from: String(12 * 60 * 60),
      to: "0",
    });
  });
});
