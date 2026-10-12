import { defineConfig } from "vite";
import { execSync } from "node:child_process";

function buildId(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    // Vite writes vite.config.ts.timestamp-*.mjs into the repo while it loads this file; that is not a change to the source.
    const changes = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .split("\n")
      .filter((line) => line.trim() && !/\.timestamp-\d+-[0-9a-f]+\.mjs$/.test(line));
    const dirty = changes.length ? "-dirty" : "";
    return `${sha}${dirty}`;
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  worker: { format: "es" },
  build: { target: "es2022" },
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  test: { environment: "node" },
} as Parameters<typeof defineConfig>[0]);
