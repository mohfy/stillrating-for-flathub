import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const sourceDir = resolve(repoRoot, "extension");
const distDir = resolve(repoRoot, "dist");
const outputDir = resolve(distDir, "chrome");
const manifestPath = resolve(outputDir, "manifest.json");

rmSync(outputDir, { force: true, recursive: true });
mkdirSync(outputDir, { recursive: true });
cpSync(sourceDir, outputDir, { recursive: true });

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

delete manifest.browser_specific_settings;
manifest.icons = {
  "16": "icons/icon16.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

if (!existsSync(manifestPath)) {
  throw new Error("Chrome manifest build failed.");
}

const archiveName = `stillrating-for-flathub-chrome-v${manifest.version}.zip`;
const archivePath = resolve(distDir, archiveName);

rmSync(archivePath, { force: true });

try {
  execFileSync("zip", ["-rq", archivePath, "."], {
    cwd: outputDir,
    stdio: "pipe"
  });
} catch (error) {
  throw new Error(
    `Chrome archive build failed. Make sure the 'zip' command is available. ${error.message}`
  );
}

console.log(`Built Chrome package in ${outputDir}`);
console.log(`Created upload archive at ${archivePath}`);
