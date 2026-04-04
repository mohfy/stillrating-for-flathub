import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const sourceDir = resolve(repoRoot, "extension");
const outputDir = resolve(repoRoot, "dist", "firefox");
const manifestPath = resolve(outputDir, "manifest.json");

rmSync(outputDir, { force: true, recursive: true });
mkdirSync(outputDir, { recursive: true });
cpSync(sourceDir, outputDir, { recursive: true });

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.background && "service_worker" in manifest.background) {
  delete manifest.background.service_worker;
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

if (!existsSync(manifestPath)) {
  throw new Error("Firefox manifest build failed.");
}

console.log(`Built Firefox package in ${outputDir}`);
