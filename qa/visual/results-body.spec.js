import fs from "node:fs";
import { test, expect } from "@playwright/test";

const PLAN = JSON.parse(
    fs.readFileSync(new URL("./fixtures/plan-response.json", import.meta.url), "utf8")
);

test("Asystent pokazuje wspólne Etapy i tabelę rok po roku", async ({ page }) => {
    await page.goto("/wizard", { waitUntil: "networkidle" });
    await page.evaluate((plan) => {
        localStorage.removeItem("fire.wizardState");
        localStorage.setItem(
            "fire.wizardPlan",
            JSON.stringify({ plan, path: plan.path, selectedScenario: "realne" })
        );
    }, PLAN);
    await page.goto("/wizard?restore=1", { waitUntil: "networkidle" });

    await expect(page.locator("#wzResult")).toBeVisible({ timeout: 120_000 });
    await expect(page.locator("#wzStageSummary .stage-line")).not.toHaveCount(0, {
        timeout: 30_000,
    });
    await expect(page.locator("#wzYearTable table")).toHaveCount(1, {
        timeout: 30_000,
    });
    await expect(page.locator("#wzYearTable tbody tr")).not.toHaveCount(0);
    await expect(page.locator("#wzYearTable .density-control")).toBeVisible();
});

test("Symulator pokazuje wspólne planowanie i wykresy SVG", async ({ page }) => {
    const input = PLAN.input;

    await page.goto("/sim", { waitUntil: "networkidle" });
    await page.evaluate((input) => {
        localStorage.setItem(
            "fire.wizardDraft",
            JSON.stringify({ ...input, source: "test" })
        );
    }, input);
    await page.goto("/sim?wizard=1", { waitUntil: "networkidle" });

    await expect(page.locator("#results")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#simHero")).not.toBeEmpty();
    await expect(page.locator("#planTime .wz-gantt-row")).not.toHaveCount(0);
    await expect(page.locator("#planTime .stage-line")).not.toHaveCount(0);
    await expect(page.locator("#wealthChart svg")).toBeVisible();
    await expect(page.locator("#withdrawalChart svg")).toBeVisible();
    await expect(page.locator("#simDetails details")).toBeVisible();
});
