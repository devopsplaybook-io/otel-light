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
