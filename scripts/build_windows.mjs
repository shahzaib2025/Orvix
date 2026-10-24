import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const project = process.cwd();
const builder = path.join(project, "node_modules", "electron-builder", "cli.js");
const releaseDirectory = path.resolve(project, "release");
const appDirectory = path.join(project, "release", "win-unpacked");
if (path.dirname(releaseDirectory) !== path.resolve(project)) throw new Error("Unexpected package output path");
if (existsSync(releaseDirectory)) {
  if (path.dirname(realpathSync.native(releaseDirectory)) !== realpathSync.native(project)) throw new Error("Package output points outside this project");
  rmSync(releaseDirectory, { recursive: true, force: true });
}

function build(args) {
  const result = spawnSync(process.execPath, [builder, ...args], { cwd: project, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function brokenNsisCache() {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const cacheRoot = path.resolve(localAppData, "electron-builder", "Cache");
  const cacheDirectory = path.resolve(cacheRoot, "nsis-3.0.4.1");
  if (path.dirname(cacheDirectory) !== cacheRoot || !existsSync(cacheDirectory)) return null;
  for (const name of readdirSync(cacheDirectory)) {
    const compiler = path.join(cacheDirectory, name, "Bin", "makensis.exe");
    if (!existsSync(compiler)) continue;
    const result = spawnSync(compiler, ["/VERSION"], { stdio: "ignore" });
    return result.status === 0 ? null : cacheDirectory;
  }
  return null;
}

let status = build(["--win", "nsis"]);
if (status !== 0 && existsSync(appDirectory)) {
  const cacheDirectory = brokenNsisCache();
  if (cacheDirectory) {
    console.log("[Orvix] Refreshing the damaged local NSIS compiler and retrying setup packaging...");
    rmSync(cacheDirectory, { recursive: true, force: true });
    status = build(["--win", "nsis", "--prepackaged", appDirectory]);
  }
}
if (status !== 0) process.exit(status);

process.exit(build(["--win", "msi", "--prepackaged", appDirectory]));
