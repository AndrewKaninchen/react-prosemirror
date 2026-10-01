import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import puppeteer from "puppeteer-core";
import { build, preview } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const executablePath =
  process.env.CHROME_PATH ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find(existsSync);
assert(executablePath, "Set CHROME_PATH to a Chromium browser executable");

const config = {
  root: `${root}/benchmarks/progressive-mount`,
  configFile: `${root}/vite.config.ts`,
  build: { outDir: `${root}/.benchmark-dist`, emptyOutDir: true },
  logLevel: "error",
};
await build(config);
const server = await preview({
  ...config,
  preview: { host: "127.0.0.1", port: 4174 },
});
const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4174");
  for (const batchSize of [undefined, 25]) {
    const result = await page.evaluate(
      (settings) => window.runBenchmark(settings),
      {
        count: Number(process.env.BENCHMARK_COUNT ?? 1000),
        workMs: Number(process.env.BENCHMARK_WORK_MS ?? 0.15),
        batchSize,
      }
    );
    assert.equal(result.mounted, result.count);
    assert(
      result.selectionValid,
      "The selection and tail DOM mapping must survive loading"
    );
    assert(result.editValid, "The editor must accept edits after loading");
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(JSON.stringify(result));
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
