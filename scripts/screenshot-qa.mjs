#!/usr/bin/env node

/**
 * Screenshot QA Script — macOS-compatible
 * Takes a screenshot of a URL using Puppeteer for visual QA.
 *
 * Usage:
 *   node screenshot-qa.mjs <url> [label] [viewport-width]
 *
 * Examples:
 *   node screenshot-qa.mjs http://localhost:3000
 *   node screenshot-qa.mjs http://localhost:3000 homepage
 *   node screenshot-qa.mjs http://localhost:3000 mobile 375
 *
 * Output:
 *   ./qa-screenshots/screenshot-1.png
 *   ./qa-screenshots/screenshot-2-homepage.png
 *   ./qa-screenshots/screenshot-3-mobile.png
 */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const url = process.argv[2];
const label = process.argv[3] || "";
const viewportWidth = parseInt(process.argv[4], 10) || 1440;
const viewportHeight = 900;

if (!url) {
  console.error("Usage: node screenshot-qa.mjs <url> [label] [viewport-width]");
  process.exit(1);
}

const screenshotDir = path.join(process.cwd(), "qa-screenshots");
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

// Find next available screenshot number (auto-increment, never overwrite)
const existing = fs
  .readdirSync(screenshotDir)
  .filter((f) => f.startsWith("screenshot-") && f.endsWith(".png"))
  .map((f) => parseInt(f.split("-")[1], 10))
  .filter((n) => !isNaN(n));
const nextNum = existing.length > 0 ? Math.max(...existing) + 1 : 1;

const filename = label
  ? `screenshot-${nextNum}-${label}.png`
  : `screenshot-${nextNum}.png`;
const outputPath = path.join(screenshotDir, filename);

async function takeScreenshot() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: viewportWidth, height: viewportHeight });

  try {
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
  } catch (err) {
    console.error(`Failed to load ${url}: ${err.message}`);
    await browser.close();
    process.exit(1);
  }

  await page.screenshot({ path: outputPath, fullPage: true });
  console.log(`Screenshot saved: ${outputPath}`);
  console.log(`Viewport: ${viewportWidth}x${viewportHeight}`);

  await browser.close();
}

takeScreenshot().catch((err) => {
  console.error(`Screenshot failed: ${err.message}`);
  process.exit(1);
});
