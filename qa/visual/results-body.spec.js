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
            JSON.stringify({
                version: 3,
                plan,
                path: plan.path,
                selectedScenario: "realne",
            })
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
    const postHorizon = page.locator("#wzYearTable tr.post-horizon");
    await expect(postHorizon).toHaveCount(1);
    await expect(postHorizon.locator(".col-age")).toHaveText("96+");
    await expect(postHorizon.locator(".col-stage")).toContainText("Tylko ZUS");
    const headers = page.locator("#wzYearTable thead th");
    await expect(headers.nth(2)).toHaveText("Wypłata mies.");
    await expect(headers.nth(3)).toHaveText("Majątek");
    await expect(headers.nth(4)).toHaveText("Wypłata roczna");
    await expect(headers.nth(5)).toHaveText("Podatek");
    await expect(page.locator("#wzYearTable tbody tr").first().locator("td.col-monthly"))
        .toHaveCSS("font-weight", "700");
    await expect(postHorizon.locator("td.col-monthly")).toHaveCSS("font-weight", "700");

    await expect(page.locator("#wzWithdrawalsChart .wz-chart-reference-label").first())
        .toContainText("średnia");
    await expect(page.locator("#wzCapitalChart .wz-chart-reference-label")).toContainText("szczyt");
    await expect(page.locator("#wzCapitalChart .wz-chart-reference-dot")).toHaveCount(1);

    const withdrawalAxis = await page.locator("#wzWithdrawalsChart .wz-chart-axis-y").allTextContents();
    const capitalAxis = await page.locator("#wzCapitalChart .wz-chart-axis-y").allTextContents();
    expect(new Set(withdrawalAxis).size).toBe(withdrawalAxis.length);
    expect(withdrawalAxis.some((label) => label.includes("tys."))).toBe(false);
    await expect(page.locator("#wzCapitalChart .wz-chart-unit")).toHaveText("tys. zł");
    expect(new Set(capitalAxis).size).toBe(capitalAxis.length);
    expect(capitalAxis.some((label) => label.includes("tys."))).toBe(false);
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

    await expect(page.locator(".stage-block").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#results")).toBeHidden();
    await page.locator("#simulateBtn").click();
    await expect(page.locator("#results")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#wzHeroAnswer")).not.toBeEmpty();
    await expect(page.locator("#wzMetrics .metric")).toHaveCount(7);
    await expect(page.locator("[data-results-plan-time] .wz-gantt-row")).not.toHaveCount(0);
    await expect(page.locator("[data-results-plan-time] .stage-line")).not.toHaveCount(0);
    await expect(page.locator("#wzAccountFlows tbody tr")).not.toHaveCount(0);
    await expect(page.locator("#wzWithdrawalsChart svg")).toBeVisible();
    await expect(page.locator("#wzCapitalChart svg")).toBeVisible();
    await expect(page.locator("#wzChartMilestonesToggle")).toBeVisible();
    await expect(page.locator("#wzYearTable tr.post-horizon")).toHaveCount(1);
    await expect(page.locator("#wzFacts .chip")).not.toHaveCount(0);
    await expect(page.locator("#wzWithdrawalsChart .wz-chart-axis-text").last()).toHaveText("100");
    const chartGeometry = await page.locator("#wzWithdrawalsChart").evaluate((container) => {
        const svg = container.querySelector("svg");
        return {
            clientWidth: container.clientWidth,
            viewBoxWidth: svg?.viewBox?.baseVal?.width || 0,
            height: Math.round(svg?.getBoundingClientRect().height || 0),
        };
    });
    expect(Math.abs(chartGeometry.viewBoxWidth - chartGeometry.clientWidth)).toBeLessThan(2);
    expect(chartGeometry.height).toBeLessThan(300);
});
