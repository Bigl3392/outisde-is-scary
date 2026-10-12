import { defineConfig } from "vite";
import { execSync } from "node:child_process";

function buildId(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() ? "-dirty" : "";
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
