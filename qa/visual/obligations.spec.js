import fs from "node:fs";
import { test, expect } from "@playwright/test";

const PLAN = JSON.parse(
    fs.readFileSync(new URL("./fixtures/plan-response.json", import.meta.url), "utf8")
);
const BARISTA_INPUT = JSON.parse(
    fs.readFileSync(new URL("./fixtures/barista-obligation-input.json", import.meta.url), "utf8")
);
const NO_ZUS_INPUT = JSON.parse(
    fs.readFileSync(new URL("./fixtures/no-zus-obligation-input.json", import.meta.url), "utf8")
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
    await expect(row.locator(".obligation-redirect-yes")).toBeChecked();

    await page.locator("#simulateBtn").click();
    await expect(page.locator("#results")).toBeVisible({ timeout: 30_000 });

    await expect(page.locator("#wzFacts")).toContainText("Zobowiązania");
    await expect(page.locator("#wzFacts")).toContainText("Alimenty");
    await expect(page.locator("#wzStageSummary .stage-line")).toHaveCount(5);
    await expect(page.locator("#wzMetrics .metric-label").first()).toContainText(
        "Suma wypłat z portfela"
    );
    await expect(page.locator("#wzMetrics")).toContainText("Średni budżet na życie");
    await expect(page.locator("#wzMetrics")).toContainText("Minimalny budżet na życie");
});

test("Symulator: nie dolicza drugi raz przekierowania z Asystenta", async ({ page }) => {
    const input = JSON.parse(JSON.stringify(PLAN.input));
    input.obligations = [{
        name: "Zobowiązanie",
        monthly: 2000,
        start_age: 40,
        end_age: 45,
        redirect_to_savings: true,
    }];
    input.redirects_applied = true;

    await page.goto("/sim", { waitUntil: "networkidle" });
    await page.evaluate((payload) => {
        localStorage.setItem(
            "fire.wizardDraft",
            JSON.stringify({ ...payload, source: "test" })
        );
    }, input);
    await page.goto("/sim?wizard=1", { waitUntil: "networkidle" });

    const annualMonthly = (stages) => stages
        .filter((stage) => stage.stage_type === "akumulacja")
        .reduce((sum, stage) => sum + Object.values(stage.accounts || {})
            .reduce((inner, account) => inner + (Number(account.annual_contribution) || 0), 0) / 12, 0);
    const before = annualMonthly(input.stages);
    const data = await page.evaluate(() => gatherFormData());
    const accumulation = data.stages.filter((stage) => stage.stage_type === "akumulacja");
    expect(data.redirects_applied).toBe(true);
    expect(accumulation).toHaveLength(1);
    expect(accumulation[0].name).not.toContain("po zobowiązaniu");
    expect(annualMonthly(data.stages)).toBeCloseTo(before, 5);
});

test("Symulator: odrzuca stary draft bez nowej semantyki", async ({ page }) => {
    await page.goto("/sim", { waitUntil: "networkidle" });
    await page.evaluate((input) => {
        localStorage.setItem(
            "fire.wizardDraft",
            JSON.stringify({ version: 2, input, source: "test" })
        );
    }, PLAN.input);
    await page.goto("/sim?wizard=1", { waitUntil: "networkidle" });
    await expect(page.locator("#stages-container .stage-block")).toHaveCount(0);
    await expect(page.locator("#wizardDraftBar")).toBeHidden();
});

test("Symulator: zachowuje logiczne etapy Baristy z Asystenta", async ({ page }) => {
    expect(
        BARISTA_INPUT.stages.some((stage) => Boolean(stage.origin_stage_id))
    ).toBeTruthy();

    await page.goto("/sim", { waitUntil: "networkidle" });
    await page.evaluate((input) => {
        localStorage.setItem(
            "fire.wizardDraft",
            JSON.stringify({ ...input, source: "test" })
        );
    }, BARISTA_INPUT);
    await page.goto("/sim?wizard=1", { waitUntil: "networkidle" });

    const gathered = await page.evaluate(() => gatherFormData());
    const realization = gathered.stages.filter((stage) => stage.stage_type === "realizacja");
    expect(realization.every((stage) => Boolean(stage.origin_stage_id))).toBeTruthy();

    await page.locator("#simulateBtn").click();
    await expect(page.locator("#results")).toBeVisible({ timeout: 30_000 });
    const timeline = await page.locator("#wzTimeline").innerText();
    expect(timeline).toContain("45–55");
    expect(timeline).toContain("55–65");
    expect(timeline).not.toContain("45–48");
});

test("Symulator: zachowuje granicę emerytury w planie bez ZUS", async ({ page }) => {
    await page.goto("/sim", { waitUntil: "networkidle" });
    await page.evaluate((input) => {
        localStorage.setItem(
            "fire.wizardDraft",
            JSON.stringify({ ...input, source: "test" })
        );
    }, NO_ZUS_INPUT);
    await page.goto("/sim?wizard=1", { waitUntil: "networkidle" });

    await page.locator("#simulateBtn").click();
    await expect(page.locator("#results")).toBeVisible({ timeout: 30_000 });
    const timeline = await page.locator("#wzTimeline").innerText();
    expect(timeline).toContain("55–65");
    expect(timeline).toContain("65–85");
    expect(timeline).not.toContain("55–70");
});

test("Asystent: zobowiązanie czasowe jest osobną listą i trafia do planu", async ({ page }) => {
    await page.goto("/wizard", { waitUntil: "networkidle" });

    for (let step = 1; step < 5; step += 1) {
        await page.locator("#wzNextBtn").click();
    }
    await expect(page.locator('.wz-step[data-step-id="oszczednosci"]')).toBeVisible();
    await expect(page.locator("#wzObligationsPanel")).toBeVisible();
    await expect(page.locator("#wzObligationsBox")).toBeHidden();
    await page.locator("label.seg-option", { hasText: "Mam zobowiązania" }).click();
    await expect(page.locator("#wzObligationsBox")).toBeVisible();
    await page.locator('[data-obligation-type="alimenty"]').click();
    const row = page.locator("#wzObligationsList .obligation-row").first();
    await expect(row.locator(".obligation-name")).toHaveValue("Alimenty");
    await row.locator(".obligation-monthly").fill("2000");
    await row.locator(".obligation-start").fill("40");
    await row.locator(".obligation-end").fill("50");
    await expect(row.locator(".obligation-redirect")).toBeVisible();
    await row.locator("label.seg-option", { hasText: "Zostawić w budżecie" }).click();
    await expect(row.locator(".obligation-redirect-no")).toBeChecked();
    await row.locator("label.seg-option", { hasText: "Przekierować na oszczędności" }).click();
    await expect(row.locator(".obligation-redirect-yes")).toBeChecked();
    await row.locator(".obligation-end").fill("60");
    await expect(row.locator(".obligation-redirect")).toBeHidden();
    await expect(row.locator(".obligation-redirect-note")).toBeVisible();

    await page.locator('[data-obligation-type="inne"]').click();
    const customRow = page.locator("#wzObligationsList .obligation-row").nth(1);
    await expect(customRow.locator(".obligation-name")).toHaveValue("Zobowiązanie");
    await customRow.locator(".obligation-remove").click();
    await expect(page.locator("#wzObligationsList .obligation-row")).toHaveCount(1);

    for (let step = 0; step < 6; step += 1) {
        const current = await page.locator(".wz-step:not(.hidden)").getAttribute("data-step-id");
        if (current === "wynik") break;
        await page.locator("#wzNextBtn").click();
    }
    await expect(page.locator("#wzResult")).toBeVisible({ timeout: 120_000 });
    await expect(page.locator("#wzHeroAnswer")).toContainText("budżet na życie po zobowiązaniach");
    await expect(page.locator("#wzFacts")).toContainText("Zobowiązania");
    await expect(page.locator("#wzFacts")).toContainText("Alimenty");
    await expect(page.locator("#wzFacts")).toContainText("Budżet na życie");
    await expect(page.locator("#wzYearTable thead")).toContainText("Budżet na życie");
    await expect(page.locator("#wzObligationsCosts")).toBeVisible();
    await expect(page.locator("#wzObligationsCosts")).toContainText("Zobowiązania");
    await expect(page.locator("#wzObligationsCosts .wz-cost-row")).toHaveCount(1);
    await expect(page.locator(".wz-chart-lifestyle")).toHaveCount(0);
    await expect(
        page.locator(".wz-chart-milestone", { hasText: "Koniec zob." }).first()
    ).toBeVisible({ timeout: 30_000 });
});
