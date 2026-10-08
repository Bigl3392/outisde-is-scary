import { defineConfig } from "vite";

export default defineConfig({
  worker: { format: "es" },
  build: { target: "es2022" },
  test: { environment: "node" },
} as Parameters<typeof defineConfig>[0]);
