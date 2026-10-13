// Screenshots every studio page in light and dark for a by-eye audit.
// Usage: node scripts/dev/theme-audit.mjs <out-dir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import "../../tests/helpers/awake.mjs";
import { livedWorld, serve } from "../../tests/helpers/ta-world.mjs";
const out = process.argv[2] || "theme-audit";
mkdirSync(out, { recursive: true });
const w = await livedWorld();
const server = await serve(w);
const browser = await chromium.launch({ headless: true });
try {
  for (const scheme of ["light", "dark"]) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      colorScheme: scheme,
    });
    await page.goto(server.base + "#people");
    await page.locator(".dock-link").first().waitFor();
    const pages = await page
      .locator(".dock-link")
      .evaluateAll((els) => els.map((e) => e.dataset.page).filter(Boolean));
    for (const name of pages) {
      await page.locator(`.dock-link[data-page="${name}"]`).click();
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${out}/${scheme}-${name}.png` });
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close?.();
  w.close?.();
}
process.exit(0);
