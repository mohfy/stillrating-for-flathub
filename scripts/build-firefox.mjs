import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const sourceDir = resolve(repoRoot, "extension");
const buildDir = resolve(repoRoot, ".build");
const tempDir = resolve(buildDir, "firefox");
const xpiDir = resolve(buildDir, "xpi");
const manifestPath = resolve(tempDir, "manifest.json");

rmSync(tempDir, { force: true, recursive: true });
mkdirSync(tempDir, { recursive: true });
mkdirSync(xpiDir, { recursive: true });
cpSync(sourceDir, tempDir, { recursive: true });

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.background && "service_worker" in manifest.background) {
  delete manifest.background.service_worker;
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

if (!existsSync(manifestPath)) {
  throw new Error("Firefox manifest build failed.");
}

const archivePath = resolve(xpiDir, "stillrating-for-flathub-firefox.xpi");

rmSync(archivePath, { force: true });

try {
  execFileSync("zip", ["-rq", archivePath, "."], {
    cwd: tempDir,
    stdio: "pipe"
  });
} catch (error) {
  throw new Error(
    `Firefox archive build failed. Make sure the 'zip' command is available. ${error.message}`
  );
}

console.log(`Built Firefox package in ${tempDir}`);
console.log(`Created Firefox XPI at ${archivePath}`);
