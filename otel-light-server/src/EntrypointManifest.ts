import * as fs from "fs";

/**
 * Rewrites the PWA manifest title by parsing and re-serializing the JSON, so
 * arbitrary APPLICATION_TITLE values (/, &, \, quotes, newlines, non-ASCII)
 * cannot corrupt the file the way a sed substitution would.
 */
export function EntrypointManifestSetTitle(
  manifestPath: string,
  title: string,
): void {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.name = title;
  manifest.short_name = title;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

if (require.main === module) {
  const manifestPath = process.argv[2];
  const title = process.argv[3] || "OTel Light";
  if (!manifestPath) {
    console.error(
      "Usage: node EntrypointManifest.js <manifest-path> [application-title]",
    );
    process.exit(1);
  }
  EntrypointManifestSetTitle(manifestPath, title);
}
