import { test, expect } from "@playwright/test";

// Strony publiczne (routes.py) — wszystkie bez logowania.
const PAGES = ["/", "/login", "/sim", "/sim?view=config", "/wizard", "/compare", "/moje-symulacje"];

for (const path of PAGES) {
    const slug = path.replace(/[^a-z0-9]/gi, "_").replace(/^_+/, "") || "root";
    test(`shot ${slug}`, async ({ page }) => {
        await page.goto(path, { waitUntil: "networkidle" });
        // Inter jest bundlowany z font-display: swap — poczekaj na podmianę,
        // inaczej screenshot potrafi złapać fallback i różnić się o kilka pikseli.
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);
        await expect(page).toHaveScreenshot({ fullPage: true });
    });
}