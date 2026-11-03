import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EntrypointManifestSetTitle } from "./EntrypointManifest";

describe("EntrypointManifestSetTitle", () => {
  let tempDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "otel-light-manifest-"));
    manifestPath = path.join(tempDir, "manifest.webmanifest");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        name: "APPLICATION_TITLE",
        short_name: "APPLICATION_TITLE",
        start_url: "/",
        theme_color: "#12191f",
        icons: [{ src: "/images/logo.png", sizes: "512x512" }],
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it.each([
    ["plain", "OTel Light"],
    ["slashes", "R&D / Ops"],
    ["ampersand and backslash", "Research & Dev \\ Ops"],
    ["quotes", 'Team "A" & <B>'],
    ["non-ascii", "Télémétrie — 日本語 🚀"],
    ["newlines", "Line one\nLine two"],
  ])("keeps the manifest valid JSON for %s titles", (_label, title) => {
    EntrypointManifestSetTitle(manifestPath, title);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.name).toBe(title);
    expect(manifest.short_name).toBe(title);
    expect(manifest.start_url).toBe("/");
    expect(manifest.theme_color).toBe("#12191f");
    expect(manifest.icons).toEqual([
      { src: "/images/logo.png", sizes: "512x512" },
    ]);
  });
});
