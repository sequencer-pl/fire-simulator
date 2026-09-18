import { defineConfig } from "@playwright/test";

// Harness regresji wizualnej — urlopy screenshota porównują z baseline.
// Backend musi działać na http://localhost:8000 (uv run uvicorn app.main:app).
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.js",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  snapshotDir: "baselines",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      maxDiffPixel: 200,
      animations: "disabled",
    },
  },
  use: {
    baseURL: "http://localhost:8000",
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});