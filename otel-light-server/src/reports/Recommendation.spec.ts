jest.mock("axios", () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

jest.mock("../OTelContext", () => {
  const span = {
    end: jest.fn(),
    addEvent: jest.fn(),
    setStatus: jest.fn(),
  };
  const moduleLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    OTelLogger: () => ({ createModuleLogger: () => moduleLogger }),
    OTelTracer: () => ({ startSpan: () => span }),
  };
});

jest.mock("../ScheduledJobs", () => ({
  ScheduledJobRegisterCron: jest.fn(),
  ScheduledJobRunDelayed: jest.fn(),
}));

import axios from "axios";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { callLLMWithRetry, RecommendationInit } from "./Recommendation";

const postMock = axios.post as jest.Mock;
const fakeSpan = { end: jest.fn() } as never;

describe("callLLMWithRetry overall timeout (M10)", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "otel-light-rec-"));
    await RecommendationInit(fakeSpan, {
      DATA_DIR: tmpDir,
      // No API key: only initializes the storage path, no cron scheduling.
      LLM_API_KEY: "",
      LLM_RECOMMENDATION_SCHEDULE_CRON: "20 0 * * *",
      LLM_RECOMMENDATION_STARTUP_DELAY_MINUTES: 0,
      LLM_RECOMMENDATION_TIMEOUT_SECONDS: 0.05,
      SCHEDULED_JOB_JITTER_MINUTES: 5,
      SCHEDULED_JOB_OVERLAP_WAIT_MINUTES: 30,
    } as never);
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  beforeEach(() => {
    postMock.mockReset();
  });

  it("stops retrying and fails fast once the overall budget is spent", async () => {
    postMock.mockRejectedValue(new Error("upstream 500"));
    const startedAt = Date.now();

    await expect(callLLMWithRetry("prompt")).rejects.toThrow("upstream 500");

    // The first backoff (1s) would exceed the 50ms budget, so no retry is
    // attempted and the call returns immediately instead of waiting.
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("returns the LLM content on success", async () => {
    postMock.mockResolvedValue({
      data: { choices: [{ message: { content: "hello" } }] },
    });

    await expect(callLLMWithRetry("prompt")).resolves.toBe("hello");
  });
});
