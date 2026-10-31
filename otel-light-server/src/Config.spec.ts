// C1 regression: JWT_KEY is managed at runtime by AuthInit() (per-deployment
// key stored in the DB metadata table). Config reloads (file watch, env) must
// never clobber it back to a config value like the public "dev" default.

jest.mock("./OTelContext", () => {
  const moduleLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    __moduleLogger: moduleLogger,
    OTelLogger: () => ({ createModuleLogger: () => moduleLogger }),
    OTelTracer: () => undefined,
    OTelMeter: () => undefined,
  };
});

import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Config } from "./Config";

const mockModuleLogger = (
  jest.requireMock("./OTelContext") as {
    __moduleLogger: { error: jest.Mock };
  }
).__moduleLogger;

describe("Config JWT_KEY handling (C1)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "otel-light-config-"));
    jest.clearAllMocks();
    delete process.env.JWT_KEY;
  });

  afterEach(async () => {
    delete process.env.JWT_KEY;
    await fs.remove(tmpDir);
  });

  const newConfig = async (configContent?: object): Promise<Config> => {
    const configFile = path.join(tmpDir, "config.json");
    if (configContent) {
      await fs.writeJson(configFile, configContent);
    }
    const config = new Config();
    config.CONFIG_FILE = configFile;
    return config;
  };

  it("keeps the runtime (DB-managed) key across a config file reload", async () => {
    const config = await newConfig({
      JWT_KEY: "dev",
      MAINTENANCE_FREQUENCY_HOURS: 3,
    });
    config.JWT_KEY = "db-managed-key"; // as set by AuthInit()
    await config.reload();
    expect(config.JWT_KEY).toBe("db-managed-key");
    // Regular fields still reload from the file.
    expect(config.MAINTENANCE_FREQUENCY_HOURS).toBe(3);
  });

  it("keeps the runtime key when the environment sets a default key", async () => {
    process.env.JWT_KEY = "dev";
    const config = await newConfig();
    config.JWT_KEY = "db-managed-key";
    await config.reload();
    expect(config.JWT_KEY).toBe("db-managed-key");
  });

  it("warns when the effective key is a known default", async () => {
    const config = await newConfig();
    config.JWT_KEY = "dev";
    await config.reload();
    expect(mockModuleLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("SECURITY WARNING"),
    );
  });

  it("does not warn for a unique key", async () => {
    const config = await newConfig();
    config.JWT_KEY = "c9f1f7a4-2b6e-4c8a-9b0d-1e2f3a4b5c6d";
    await config.reload();
    expect(mockModuleLogger.error).not.toHaveBeenCalled();
  });
});

describe("Config INGESTION_BODY_LIMIT_BYTES", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "otel-light-config-"));
    jest.clearAllMocks();
    delete process.env.INGESTION_BODY_LIMIT_BYTES;
  });

  afterEach(async () => {
    delete process.env.INGESTION_BODY_LIMIT_BYTES;
    await fs.remove(tmpDir);
  });

  const newConfig = async (configContent?: object): Promise<Config> => {
    const configFile = path.join(tmpDir, "config.json");
    if (configContent) {
      await fs.writeJson(configFile, configContent);
    }
    const config = new Config();
    config.CONFIG_FILE = configFile;
    return config;
  };

  it("defaults to 1 MiB", async () => {
    const config = await newConfig();
    await config.reload();
    expect(config.INGESTION_BODY_LIMIT_BYTES).toBe(1_048_576);
  });

  it("reads the value from the config file", async () => {
    const config = await newConfig({ INGESTION_BODY_LIMIT_BYTES: 4_194_304 });
    await config.reload();
    expect(config.INGESTION_BODY_LIMIT_BYTES).toBe(4_194_304);
  });

  it("reads the value from the environment as a number", async () => {
    process.env.INGESTION_BODY_LIMIT_BYTES = "2097152";
    const config = await newConfig();
    await config.reload();
    expect(config.INGESTION_BODY_LIMIT_BYTES).toBe(2_097_152);
  });

  it("clamps above the maximum", async () => {
    const config = await newConfig({ INGESTION_BODY_LIMIT_BYTES: 999_999_999 });
    await config.reload();
    expect(config.INGESTION_BODY_LIMIT_BYTES).toBe(16_777_216);
  });

  it("clamps below the minimum", async () => {
    const config = await newConfig({ INGESTION_BODY_LIMIT_BYTES: 0 });
    await config.reload();
    expect(config.INGESTION_BODY_LIMIT_BYTES).toBe(1_024);
  });

  it("rejects the reload for a non-numeric value", async () => {
    process.env.INGESTION_BODY_LIMIT_BYTES = "abc";
    const config = await newConfig();
    await expect(config.reload()).rejects.toThrow(
      /Invalid numeric value for INGESTION_BODY_LIMIT_BYTES/,
    );
  });

  it("keeps the runtime JWT_KEY when the reload is rejected", async () => {
    process.env.INGESTION_BODY_LIMIT_BYTES = "abc";
    try {
      const config = await newConfig({ JWT_KEY: "dev" });
      config.JWT_KEY = "db-managed-key";
      await expect(config.reload()).rejects.toThrow(/Invalid numeric value/);
      expect(config.JWT_KEY).toBe("db-managed-key");
    } finally {
      delete process.env.INGESTION_BODY_LIMIT_BYTES;
    }
  });
});

describe("Config scheduled work and analytics stats defaults (M8/M10)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "otel-light-config-"));
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  const newConfig = async (configContent?: object): Promise<Config> => {
    const configFile = path.join(tmpDir, "config.json");
    if (configContent) {
      await fs.writeJson(configFile, configContent);
    }
    const config = new Config();
    config.CONFIG_FILE = configFile;
    return config;
  };

  it("ships distinct, staggered cron defaults for the heavy jobs", async () => {
    const config = await newConfig();
    await config.reload();

    const crons = [
      config.LLM_RECOMMENDATION_SCHEDULE_CRON,
      config.STATIC_REPORT_SCHEDULE_CRON,
      config.MOST_CALLED_TRACES_SCHEDULE_CRON,
    ];
    expect(new Set(crons).size).toBe(crons.length);
    expect(config.SCHEDULED_JOB_JITTER_MINUTES).toBe(5);
    expect(config.SCHEDULED_JOB_OVERLAP_WAIT_MINUTES).toBe(30);
    expect(config.LLM_RECOMMENDATION_TIMEOUT_SECONDS).toBe(180);
  });

  it("ships bounded analytics stats defaults", async () => {
    const config = await newConfig();
    await config.reload();

    expect(config.ANALYTICS_STATS_SAMPLE_CAP).toBe(20000);
    expect(config.ANALYTICS_STATS_CACHE_TTL_SECONDS).toBe(30);
    expect(config.ANALYTICS_STATS_CACHE_MAX_ENTRIES).toBe(100);
  });

  it("reads the stats options from the config file", async () => {
    const config = await newConfig({
      ANALYTICS_STATS_SAMPLE_CAP: 500,
      ANALYTICS_STATS_CACHE_TTL_SECONDS: 5,
      ANALYTICS_STATS_CACHE_MAX_ENTRIES: 10,
    });
    await config.reload();

    expect(config.ANALYTICS_STATS_SAMPLE_CAP).toBe(500);
    expect(config.ANALYTICS_STATS_CACHE_TTL_SECONDS).toBe(5);
    expect(config.ANALYTICS_STATS_CACHE_MAX_ENTRIES).toBe(10);
  });

  it("clamps the LLM overall timeout to a sane range", async () => {
    const tooHigh = await newConfig({
      LLM_RECOMMENDATION_TIMEOUT_SECONDS: 999_999,
    });
    await tooHigh.reload();
    expect(tooHigh.LLM_RECOMMENDATION_TIMEOUT_SECONDS).toBe(3600);

    const tooLow = await newConfig({
      LLM_RECOMMENDATION_TIMEOUT_SECONDS: -5,
    });
    await tooLow.reload();
    expect(tooLow.LLM_RECOMMENDATION_TIMEOUT_SECONDS).toBe(0.001);
  });
});
