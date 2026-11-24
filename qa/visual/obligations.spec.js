import fs from "node:fs";
import { test, expect } from "@playwright/test";

const PLAN = JSON.parse(
    fs.readFileSync(new URL("./fixtures/plan-response.json", import.meta.url), "utf8")
);

test("Symulator: zobowiązanie czasowe zmniejsza budżet i tworzy etap akumulacji", async ({ page }) => {
    await page.goto("/sim", { waitUntil: "networkidle" });
    await page.evaluate((input) => {
        localStorage.setItem(
            "fire.wizardDraft",
            JSON.stringify({ ...input, source: "test" })
        );
    }, PLAN.input);
    await page.goto("/sim?wizard=1", { waitUntil: "networkidle" });

    await expect(page.locator("#simObligationsPanel")).toBeVisible();
    await expect(page.locator("#simHorizonAge")).toHaveCount(0);
    await expect(page.locator("#simMortgageMonthly")).toHaveCount(0);
    await expect(page.locator("#simHorizonHint")).toContainText("Horyzont planu");

    await page.locator("#addObligationBtn").click();
    const row = page.locator("#obligationsList .obligation-row").first();
    await row.locator(".obligation-name").fill("Alimenty");
    await row.locator(".obligation-monthly").fill("2000");
    await row.locator(".obligation-start").fill("35");
    await row.locator(".obligation-end").fill("50");
    await expect(row.locator(".obligation-redirect")).toBeChecked();

    await page.locator("#simulateBtn").click();
    await expect(page.locator("#results")).toBeVisible({ timeout: 30_000 });

    await expect(page.locator("#wzFacts")).toContainText("Zobowiązania");
    await expect(page.locator("#wzFacts")).toContainText("Alimenty");
    await expect(page.locator("#wzStageSummary .stage-line")).toHaveCount(5);
    await expect(page.locator("#wzMetrics .metric-label").first()).toContainText(
        "Suma wypłat z portfela"
    );
    await expect(page.locator("#wzMetrics")).toContainText("Średnia wypłata netto");
    await expect(page.locator("#wzMetrics")).toContainText("Minimalna wypłata netto");
});

test("Asystent: zobowiązanie czasowe jest osobną listą i trafia do planu", async ({ page }) => {
    await page.goto("/wizard", { waitUntil: "networkidle" });

    for (let step = 1; step < 5; step += 1) {
        await page.locator("#wzNextBtn").click();
    }
    await expect(page.locator('.wz-step[data-step-id="oszczednosci"]')).toBeVisible();
    await expect(page.locator("#wzObligationsPanel")).toBeVisible();
    await page.locator("#wzAddObligationBtn").click();
    const row = page.locator("#wzObligationsList .obligation-row").first();
    await row.locator(".obligation-name").fill("Alimenty");
    await row.locator(".obligation-monthly").fill("2000");
    await row.locator(".obligation-start").fill("40");
    await row.locator(".obligation-end").fill("60");
    await expect(row.locator(".obligation-redirect")).toBeChecked();

    for (let step = 0; step < 6; step += 1) {
        const current = await page.locator(".wz-step:not(.hidden)").getAttribute("data-step-id");
        if (current === "wynik") break;
        await page.locator("#wzNextBtn").click();
    }
    await expect(page.locator("#wzResult")).toBeVisible({ timeout: 120_000 });
    await expect(page.locator("#wzHeroAnswer")).toContainText("Po zobowiązaniach");
    await expect(page.locator("#wzFacts")).toContainText("Zobowiązania");
    await expect(page.locator("#wzFacts")).toContainText("Alimenty");
});
