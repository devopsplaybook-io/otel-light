import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";

export interface ServiceVersionEntry {
  serviceName: string;
  serviceVersion: string | null;
}

export class AnalyticsServicesRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const [rawLogsServices, rawTracesServices, rawMetricsServices] =
        await Promise.all([
          DbUtilsNoTelemetryQuerySQL(
            SQL_QUERIES.GET_SERVICES_FROM_LOGS[DbUtilsGetType()],
            [],
          ),
          DbUtilsNoTelemetryQuerySQL(
            SQL_QUERIES.GET_SERVICES_FROM_TRACES[DbUtilsGetType()],
            [],
          ),
          DbUtilsNoTelemetryQuerySQL(
            SQL_QUERIES.GET_SERVICES_FROM_METRICS[DbUtilsGetType()],
            [],
          ),
        ]);

      const serviceSet = new Set<string>();
      for (const row of rawLogsServices) {
        if (row.serviceName) serviceSet.add(row.serviceName);
      }
      for (const row of rawTracesServices) {
        if (row.serviceName) serviceSet.add(row.serviceName);
      }
      for (const row of rawMetricsServices) {
        if (row.serviceName) serviceSet.add(row.serviceName);
      }

      const services = Array.from(serviceSet).sort();

      // Build serviceName/serviceVersion pairs from logs and traces (not metrics)
      const svMap = new Map<string, Set<string>>();
      for (const row of [...rawLogsServices, ...rawTracesServices]) {
        if (!row.serviceName) continue;
        if (!svMap.has(row.serviceName)) svMap.set(row.serviceName, new Set());
        if (row.serviceVersion) svMap.get(row.serviceName)!.add(row.serviceVersion);
      }
      const serviceVersions: ServiceVersionEntry[] = [];
      for (const [serviceName, versions] of svMap.entries()) {
        if (versions.size === 0) {
          serviceVersions.push({ serviceName, serviceVersion: null });
        } else {
          for (const serviceVersion of Array.from(versions).sort()) {
            serviceVersions.push({ serviceName, serviceVersion });
          }
        }
      }

      return res.status(200).send({ services, serviceVersions });
    });
  }
}

// SQL

const SQL_QUERIES = {
  GET_SERVICES_FROM_LOGS: {
    postgres: `SELECT DISTINCT "serviceName", "serviceVersion" FROM logs WHERE "serviceName" IS NOT NULL ORDER BY "serviceName", "serviceVersion"`,
    sqlite: `SELECT DISTINCT serviceName, serviceVersion FROM logs WHERE serviceName IS NOT NULL ORDER BY serviceName, serviceVersion`,
  },
  GET_SERVICES_FROM_TRACES: {
    postgres: `SELECT DISTINCT "serviceName", "serviceVersion" FROM traces WHERE "serviceName" IS NOT NULL ORDER BY "serviceName", "serviceVersion"`,
    sqlite: `SELECT DISTINCT serviceName, serviceVersion FROM traces WHERE serviceName IS NOT NULL ORDER BY serviceName, serviceVersion`,
  },
  GET_SERVICES_FROM_METRICS: {
    postgres: `SELECT DISTINCT "serviceName" FROM metrics WHERE "serviceName" IS NOT NULL ORDER BY "serviceName"`,
    sqlite: `SELECT DISTINCT serviceName FROM metrics WHERE serviceName IS NOT NULL ORDER BY serviceName`,
  },
};
