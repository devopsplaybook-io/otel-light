import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { FileUtilsWriteJsonAtomic } from "./FileUtils";

describe("FileUtilsWriteJsonAtomic", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "otel-light-fileutils-"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it("creates missing parent directories and writes JSON", async () => {
    const file = path.join(tmpDir, "nested", "dir", "data.json");

    await FileUtilsWriteJsonAtomic(file, { answer: 42 });

    expect(await fs.readJson(file)).toEqual({ answer: 42 });
  });

  it("overwrites an existing file", async () => {
    const file = path.join(tmpDir, "data.json");
    await fs.writeJson(file, { old: true });

    await FileUtilsWriteJsonAtomic(file, { fresh: true });

    expect(await fs.readJson(file)).toEqual({ fresh: true });
  });

  it("leaves no temporary files behind on success", async () => {
    const file = path.join(tmpDir, "data.json");

    await FileUtilsWriteJsonAtomic(file, { value: 1 });

    expect(await fs.readdir(tmpDir)).toEqual(["data.json"]);
  });

  it("keeps the previous file intact when serialization fails", async () => {
    const file = path.join(tmpDir, "data.json");
    await fs.writeJson(file, { keep: true });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(FileUtilsWriteJsonAtomic(file, circular)).rejects.toThrow();

    expect(await fs.readJson(file)).toEqual({ keep: true });
    expect(await fs.readdir(tmpDir)).toEqual(["data.json"]);
  });
});
