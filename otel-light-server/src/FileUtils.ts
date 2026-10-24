import { randomBytes } from "crypto";
import * as fs from "fs";
import * as fse from "fs-extra";
import * as path from "path";

// Atomic JSON persistence: serialize first (a failure leaves the previous file
// untouched), then write + fsync a temporary sibling and rename it over the
// target. A crash mid-write can only leave a stray *.tmp file, never a
// truncated JSON document.
export async function FileUtilsWriteJsonAtomic(
  filePath: string,
  data: unknown,
): Promise<void> {
  const json = JSON.stringify(data);
  const dir = path.dirname(filePath);
  await fse.ensureDir(dir);
  const tmpPath = path.join(
    dir,
    `${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    const handle = await fs.promises.open(tmpPath, "w");
    try {
      await handle.writeFile(json, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    await fse.remove(tmpPath).catch(() => undefined);
    throw err;
  }
}
