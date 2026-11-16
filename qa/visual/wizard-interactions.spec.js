import fs from "node:fs";
import { test, expect } from "@playwright/test";

test.setTimeout(150_000);

async function expectNoHorizontalOverflow(page) {
    const dimensions = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function openManualAllocation(page) {
    await page.goto("/wizard", { waitUntil: "networkidle" });
    await page.evaluate(() => {
        const manual = document.querySelector('input[name="wzOptimizeMode"][value="manual"]');
        if (manual) manual.checked = true;
        wzSyncModeUI();
        wzShowStep("strategia");
    });
    await expect(page.locator('.wz-step[data-step-id="strategia"]')).toBeVisible();
    await page.waitForFunction(() => {
        const list = document.getElementById("wzSuggestList");
        return list
            && !list.querySelector(".spinner")
            && Boolean(list.querySelector(
                ".wz-suggest-row, .wz-manual-alloc-row, .wz-suggest-empty, .banner"
            ));
    });
}

test("/wizard opens by default with the agreed age", async ({ page }) => {
    await page.goto("/wizard", { waitUntil: "networkidle" });

    await expect(page.locator(".wizard")).toBeVisible();
    await expect(page.locator("#wzAge")).toHaveValue("40");
    await expect(page.locator("#wzStepCount")).toHaveText("Krok 1 / 9");
});

test("salary defaults to annual gross from limits and converts modes", async ({ page }) => {
    await page.goto("/wizard", { waitUntil: "networkidle" });
    const salary = page.locator("#wzEtatSalary");
    await expect(salary).toHaveValue("113000");
    await expect(page.locator("#wzEtatSalaryLabel")).toContainText("brutto (zł/rok)");
    await page.locator("#wzNextBtn").click();
    await page.locator("#wzNextBtn").click();
    await expect(page.locator("#wzEtatSalaryPreview")).toBeVisible({ timeout: 10_000 });
    const resultValues = page.locator("#wzEtatSalaryPreview .wz-salary-preview-value.is-result");
    await expect(resultValues).toHaveCount(2);
    await expect(resultValues.first()).toContainText("/mies.");
    await expect(resultValues.first()).toHaveCSS("font-weight", "700");
    await expect(page.locator("#wzEtatSalaryPreview .wz-salary-preview-sub").first())
        .toHaveCSS("font-weight", "500");

    await page.locator('label:has(input[name="wzEtatPeriod"][value="month"])').click();
    await expect(salary).toHaveValue("9417");
    await expect(resultValues.first()).toContainText("/rok");
    await page.locator('label:has(input[name="wzEtatPeriod"][value="year"])').click();
    await expect(salary).toHaveValue("113000");
    await expect(resultValues.first()).toContainText("/mies.");

    await page.locator('label:has(input[name="wzEtatSalaryMode"][value="net"])').click();
    await expect(page.locator("#wzEtatSalaryLabel")).toContainText("netto (zł/rok)");
    const netAnnual = Number(await salary.inputValue());
    expect(netAnnual).toBeGreaterThan(0);
    expect(netAnnual).toBeLessThan(113000);
    await expect(page.locator("#wzEtatSalaryPreview .wz-salary-preview-item")).toHaveCount(2);
    await page.locator('label:has(input[name="wzEtatSalaryMode"][value="gross"])').click();
    await expect(salary).toHaveValue("113000");
});

test("mobile layout stays within the screen throughout the employment path", async ({ page }) => {
    let planCalls = 0;
    page.on("request", (request) => {
        if (request.url().includes("/api/wizard/plan")) planCalls += 1;
    });
    await page.setViewportSize({ width: 320, height: 780 });
    await page.goto("/wizard", { waitUntil: "networkidle" });

    for (let step = 1; step < 9; step += 1) {
        await expect(page.locator("#wzStepCount")).toHaveText(`Krok ${step} / 9`);
        await expectNoHorizontalOverflow(page);

        const segmentOverflows = await page.locator(".wz-step:not(.hidden) .segmented").evaluateAll((segments) =>
            segments.some((segment) => segment.scrollWidth > segment.clientWidth + 1)
        );
        expect(segmentOverflows).toBe(false);

        await page.locator("#wzNextBtn").click();
    }

    await expect(page.locator("#wzStepCount")).toHaveText("Krok 9 / 9");
    await expect(page.locator("#wzResult")).toBeVisible({ timeout: 120_000 });
    await expect(page.locator("#wzHeroAnswer")).not.toBeEmpty();
    await expect(page.locator("#wzScenariosBox .wz-scenario-card")).toHaveCount(3);
    await expect(page.locator("#wzMetrics .metric")).toHaveCount(3);
    await expect(page.locator("#wzFlowsGantt .wz-gantt-row").first()).toBeVisible();
    await expect(page.locator("#wzChartsWrap")).toBeVisible();
    await expect(page.locator("#wzWithdrawalsChart svg")).toBeVisible();
    await expect(page.locator("#wzCapitalChart svg")).toBeVisible();
    await expect(page.locator("#wzWithdrawalsLegend .wz-chart-legend-item").first()).toBeVisible();
    await expect(page.locator("#wzFlowsTotal")).toContainText("Łączna suma wypłat z portfela prywatnego FIRE");
    await expect(page.locator("#wzFlowsTotal")).not.toContainText("Z ZUS");
    await expect(page.locator("#wzFlowsTableDetails")).not.toHaveAttribute("open", "");
    await expect(page.locator("#wzAccountFlows .wz-phase-badge").first()).toBeAttached();
    await expect(page.locator("#wzFlowsGantt .wz-gantt-tick").last()).toHaveText("100");
    await page.locator("#wzFlowsTableDetails summary").click();
    await expect(page.locator("#wzAccountFlows .wz-phase-badge").first()).toBeVisible();
    await expect(page.locator("#wzAccumulationFlows tbody tr").first()).toBeVisible();
    await expect(page.locator("#wzOptimizer")).not.toHaveAttribute("open", "");
    await expect(page.locator(".wz-chart-annotations-label")).toHaveText("Kamienie milowe:");
    const annotationChips = page.locator("#wzChartAnnotations .wz-chart-annotation-chip");
    await expect(annotationChips.first()).toBeVisible();
    await expect(page.locator(".wz-chart-annotation-line.is-visible")).toHaveCount(0);
    await annotationChips.nth(0).click();
    await expect(page.locator("#wzChartAnnotationNote")).toBeVisible();
    await expect(page.locator(".wz-chart-annotation-line.is-visible")).toHaveCount(2);
    await annotationChips.nth(1).click();
    await expect(annotationChips.nth(0)).not.toHaveClass(/is-active/);
    await expect(annotationChips.nth(1)).toHaveClass(/is-active/);
    await expect(page.locator(".wz-chart-annotation-line.is-visible")).toHaveCount(2);
    await annotationChips.nth(1).click();
    await expect(page.locator("#wzChartAnnotationNote")).toBeHidden();
    await expect(page.locator(".wz-chart-annotation-line.is-visible")).toHaveCount(0);
    const zusChip = page.locator(
        "#wzChartAnnotations .wz-chart-annotation-chip",
        { hasText: "ZUS" }
    ).first();
    await zusChip.click();
    await expect(page.locator("#wzChartAnnotationNote")).toContainText("65");
    await expect(page.locator("#wzChartAnnotationNote")).not.toContainText("40 r.ż.");
    await zusChip.click();
    await page.locator("#wzChartsWrap").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.locator("#wzWithdrawalsChart svg").click();
    await expect(page.locator("#wzChartTip")).toBeVisible();
    await expect(page.locator("#wzChartTip")).toContainText(/Wiek \d+/);
    await expect(page.locator("#wzChartTip .wz-chart-tip-total")).toBeVisible();
    await expect(page.locator("#wzChartTip .wz-chart-tip-total .metric-label")).toHaveText("Wypłaty netto");
    await expect(page.locator("#wzChartTip .wz-chart-tip-total .metric-value")).toContainText("/mies.");
    await page.locator("#wzChartTipClose").click();

    await page.locator("#wzTimeline .wz-timeline-segment").first().click();
    await expect(page.locator("#wzGanttTip")).toBeVisible();
    await expect(page.locator("#wzGanttTip")).toContainText(/wpłaty|wypłata netto/i);
    await page.locator("#wzGanttTipClose").click();

    await page.locator("#wzFlowsGantt .wz-gantt-phase").first().click();
    await expect(page.locator("#wzGanttTip")).toBeVisible();
    await expect(page.locator("#wzGanttTip")).toContainText(/Faza|PIT|Składka zdrowotna|Podatek jednorazowy IKZE/);
    await page.locator("#wzGanttTipClose").click();

    await page.locator("#wzDetails summary").click();
    await expect(page.locator("#wzAccountFlows .wz-flows-table")).toBeVisible();
    await expect(page.locator("#wzAccountFlows tbody tr").first()).toBeVisible();
    await expect(page.locator("#wzWealthDetails .wz-wealth-row")).toHaveCount(3);
    await expect(page.locator("#wzPolicyNote")).toContainText("Najpierw");
    await expectNoHorizontalOverflow(page);

    await page.locator("#wzOptimizer summary").click();
    await expect(page.locator("#wzOptimizer")).toHaveAttribute("open", "");
    await expectNoHorizontalOverflow(page);
    const optimizerScrolls = await page.locator("#wzOptimizerResult .table-wrap").evaluate(
        (el) => el.scrollWidth > el.clientWidth
    );
    expect(optimizerScrolls).toBe(true);
    await page.locator("#wzOptimizer summary").click();

    const answerBeforeReturn = await page.locator("#wzHeroAnswer").evaluate((el) =>
        el.textContent.replace(/\s+/g, " ").trim()
    );
    await page.locator("#wzNextBtn").click();
    await page.waitForURL("**/sim?wizard=1");
    await expect(page.locator("#results")).toBeVisible({ timeout: 30_000 });
    await page.locator("#backToWizardBtn").click();
    await page.waitForURL("**/wizard?restore=1");
    await expect(page.locator("#wzResult")).toBeVisible();
    await expect(page.locator("#wzWithdrawalsChart svg")).toBeVisible();
    await expect(page.locator("#wzCapitalChart svg")).toBeVisible();
    const answerAfterReturn = await page.locator("#wzHeroAnswer").evaluate((el) =>
        el.textContent.replace(/\s+/g, " ").trim()
    );
    expect(answerAfterReturn).toBe(answerBeforeReturn);
    expect(planCalls).toBe(1);
});

test("capital pills add repeatable accounts with editable names and configured ROI", async ({ page }) => {
    await page.goto("/wizard", { waitUntil: "networkidle" });
    for (let step = 1; step < 6; step += 1) await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step-id="kapital"]')).toBeVisible();

    const addDeposit = page.locator('.wz-add-multi[data-base="lokata"]');
    await expect(addDeposit).toContainText("Lokata");
    await expect(addDeposit).not.toContainText("Dodaj");
    await expect(addDeposit.locator(".wz-add-plus")).toBeHidden();
    await expect(addDeposit.locator(".wz-add-count")).toBeHidden();
    await addDeposit.click();
    await expect(addDeposit.locator(".wz-add-plus")).toBeVisible();
    await expect(addDeposit.locator(".wz-add-count")).toBeHidden();
    const first = page.locator('#wzSafeList .wz-cap-row[data-account="lokata"]');
    await expect(first.locator(".wz-cap-name-display")).toHaveText("Lokata");
    await expect(first.locator(".wz-cap-roi")).not.toHaveValue("");
    await expect(first.locator(".wz-cap-roi-note")).toHaveCount(0);
    await expect(first.locator(".wz-cap-roi-reset")).toBeHidden();
    const capitalColumns = await page.locator("#wzSafeList").evaluate((el) =>
        getComputedStyle(el).gridTemplateColumns.split(/\s+/).length
    );
    const expectedColumns = page.viewportSize().width <= 700 ? 1 : 3;
    expect(capitalColumns).toBe(expectedColumns);

    await first.locator(".wz-cap-name-edit-btn").click();
    await first.locator(".wz-cap-name").fill("Lokata wakacyjna");
    await first.locator(".wz-cap-name-save").click();
    await expect(first.locator(".wz-cap-name-display")).toHaveText("Lokata wakacyjna");

    await addDeposit.click();
    const second = page.locator('#wzSafeList .wz-cap-row[data-account="lokata:2"]');
    await expect(second.locator(".wz-cap-name-display")).toHaveText("Lokata #2");
    await expect(addDeposit.locator(".wz-add-count")).toHaveText("×2");
    await expect(addDeposit.locator(".wz-add-count")).toBeVisible();
    const singleOki = page.locator('.wz-add-single[data-account="oki_inw"]');
    await expect(singleOki).toContainText("OKI inwestycyjne");
    await expect(singleOki).not.toContainText("+");

    await second.locator(".wz-cap-remove").click();
    await expect(addDeposit.locator(".wz-add-count")).toBeHidden();
    await expect(addDeposit.locator(".wz-add-plus")).toBeVisible();
    await first.locator(".wz-cap-remove").click();
    await expect(addDeposit.locator(".wz-add-plus")).toBeHidden();

    const roiState = await page.evaluate(() => {
        const row = document.querySelector('#wzSafeList .wz-cap-row[data-account="lokata"]');
        return wzCollectCapital().roiOverrides.lokata || null;
    });
    expect(roiState).toBeNull();
});

test("step 8 allows a manual product split and submits the edited shares", async ({ page }) => {
    let submittedAllocations = null;
    page.on("request", (request) => {
        if (request.url().includes("/api/wizard/plan")) {
            submittedAllocations = JSON.parse(request.postData() || "{}").answers?.allocations || null;
        }
    });
    await openManualAllocation(page);

    await expect(page.locator(".wz-manual-alloc-row:not(.wz-manual-cash-row)")).toHaveCount(9);
    await expect(page.locator(".wz-manual-cash-row")).toBeVisible();
    await expect(page.locator('.wz-vehicle-select[data-account="ike"]')).toBeVisible();
    await expect(page.locator('.wz-vehicle-select[data-account="oipe"] option')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    const shares = page.locator(".wz-manual-share");
    for (let index = 0; index < await shares.count(); index += 1) await shares.nth(index).fill("0");
    await page.locator('.wz-manual-share[data-account="broker"]').fill("70");
    await page.locator('.wz-manual-share[data-account="lokata"]').fill("30");

    const submitted = await page.evaluate(() => wzCollectAnswers().allocations);
    expect(submitted).toEqual({ broker: 70, lokata: 30 });
    await expect(page.locator("#wzManualSum")).toContainText("Suma udziałów: 100%");
    await expect(page.locator(".wz-manual-cash-row")).toContainText("0 zł/mies.");
    await expectNoHorizontalOverflow(page);

    await page.locator("#wzNextBtn").click();
    await expect(page.locator("#wzResult")).toBeVisible({ timeout: 120_000 });
    expect(submittedAllocations).toEqual({ broker: 70, lokata: 30 });

    await expect(page.locator("#wzFooter #wzExportBtn")).toBeVisible();
    if (page.viewportSize().width <= 640) {
        await expect(page.locator("#wzStepCount")).toBeHidden();
        const footer = page.locator("#wzFooter");
        expect(await footer.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        const exportBox = await page.locator("#wzExportBtn").boundingBox();
        expect(Math.round(exportBox.width)).toBe(34);
    }
    const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#wzExportBtn").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.sim\.json$/);
    const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    expect(exported.schema).toBe("fire-simulation/v1");
    expect(exported.source).toBe("wizard");
    expect(exported.meta.allocation_mode).toBe("manual");
    expect(exported.meta.allocations.broker).toBe(70);
    expect(exported.input.stages.length).toBeGreaterThan(0);
});

test("manual split respects account caps, free cash and never steals from other accounts", async ({ page }) => {
    await openManualAllocation(page);
    await page.evaluate(() => {
        wzSuggested.allocations = { ike: 51.2, ikze: 20.5, broker: 28.3 };
        wzSuggested.pool_monthly = 4600;
        wzManualAllocations = wzNormalizeManualShares(wzSuggested.allocations, { exact: true });
        wzRenderManualAllocation();
    });
    const ike = page.locator('.wz-manual-share[data-account="ike"]');
    const ikze = page.locator('.wz-manual-share[data-account="ikze"]');
    const broker = page.locator('.wz-manual-share[data-account="broker"]');
    const lokata = page.locator('.wz-manual-share[data-account="lokata"]');
    await expect(ike).toHaveAttribute("max", "51.2");
    await expect(ikze).toHaveAttribute("max", "20.5");
    await expect(page.locator('.wz-manual-alloc-row[data-account="broker"] .wz-manual-annual'))
        .toContainText(/15\s*636/);

    const shares = page.locator(".wz-manual-share");
    for (let index = 0; index < await shares.count(); index += 1) await shares.nth(index).fill("0");
    await broker.fill("80");
    await expect(broker).toHaveValue("80");
    await expect(lokata).toHaveAttribute("max", "20");

    // Lokata bierze tylko wolną gotówkę; broker zostaje na 80%, mimo próby 50%.
    await lokata.fill("50");
    await expect(broker).toHaveValue("80");
    await expect(lokata).toHaveValue("20");
    await expect(page.locator("#wzManualSum")).toContainText("Suma udziałów: 100%");
    await expect(page.locator(".wz-manual-cash-row")).toContainText("0 zł/mies.");

    // Zmniejszenie jednego konta oddaje miejsce gotówce, nie innym kontom.
    await lokata.fill("10");
    await expect(broker).toHaveValue("80");
    await expect(page.locator("#wzManualSum")).toContainText("Suma udziałów: 90%");
    await expect(page.locator(".wz-manual-cash-row")).toHaveClass(/is-warning/);
    await expectNoHorizontalOverflow(page);
});

test("path 2 recalculates its required savings using manual product shares", async ({ page }) => {
    await page.goto("/wizard", { waitUntil: "networkidle" });
    await page.locator('label:has(input[name="wzPath"][value="2"])').click();
    for (let step = 1; step < 8; step += 1) await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step-id="strategia"]')).toBeVisible();
    await page.waitForFunction(() => {
        const list = document.getElementById("wzSuggestList");
        return list
            && !list.querySelector(".spinner")
            && Boolean(list.querySelector(
                ".wz-suggest-row, .wz-manual-alloc-row, .wz-suggest-empty, .banner"
            ));
    });

    await expect(page.locator(".wz-manual-alloc-row:not(.wz-manual-cash-row)")).toHaveCount(9);
    await expect(page.locator(".wz-manual-cash-row")).toBeVisible();
    await expect(page.locator("#wzManualSum")).toContainText("Suma udziałów:", { timeout: 30_000 });

    const manualSuggestion = page.waitForResponse((response) => {
        if (!response.url().includes("/api/wizard/suggest")) return false;
        const body = JSON.parse(response.request().postData() || "{}");
        const shares = body.answers?.allocations || {};
        return body.path === 2 && shares.broker === 100
            && Object.values(shares).reduce((sum, share) => sum + share, 0) === 100;
    });
    await page.evaluate(() => {
        document.querySelectorAll(".wz-manual-share").forEach((input) => {
            input.value = input.dataset.account === "broker" ? "100" : "0";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    });
    const response = await manualSuggestion;
    expect(response.status()).toBe(200);
    expect((await response.json()).pool_monthly).toBeGreaterThan(0);
    await expect(page.locator("#wzManualSum")).toContainText("Suma udziałów: 100%");
});

test("PPK/PPE choices are independent and balances live in the capital step", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/wizard", { waitUntil: "networkidle" });
    await page.locator("#wzNextBtn").click();
    await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step-id="etat"]')).toBeVisible();

    await page.locator('label:has(input[name="wzPpkState"][value="active"])').click();
    await page.locator('label:has(input[name="wzPpeState"][value="active"])').click();
    const answers = await page.evaluate(() => wzCollectAnswers({ withAllocations: false }));
    expect(answers.ppk_contributions).toBe(true);
    expect(answers.ppe_contributions).toBe(true);
    expect(answers.use_ppk).toBe(true);
    expect(answers.use_ppe).toBe(true);
    await expect(page.locator("#wzPpkRates")).toBeVisible();
    await expect(page.locator("#wzPpeRates")).toBeVisible();
    await page.locator("#wzPpkRates summary").click();
    await page.locator("#wzPpkEmployeePct").fill("3");
    const withRate = await page.evaluate(() => wzCollectAnswers({ withAllocations: false }));
    expect(withRate.ppk_employee_pct).toBeCloseTo(0.03, 5);

    for (let step = 3; step < 6; step += 1) await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step-id="kapital"]')).toBeVisible();
    await expect(page.locator("#wzPpkBalance")).toBeVisible();
    await expect(page.locator("#wzPpeBalance")).toBeVisible();
    await expectNoHorizontalOverflow(page);
});

test("B2B step 3 orders tax forms by popularity and keeps salary fields apart", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/wizard", { waitUntil: "networkidle" });
    await page.locator("#wzNextBtn").click();
    await page.locator('label:has(input[name="wzEmployment"][value="b2b"])').click();
    await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step-id="b2b"]')).toBeVisible();

    await expect(page.locator('input[name="wzB2bTaxForm"]:checked')).toHaveValue("ryczalt");
    const formOrder = await page.locator('input[name="wzB2bTaxForm"]').evaluateAll(
        (els) => els.map((el) => el.value)
    );
    expect(formOrder).toEqual(["ryczalt", "skala", "liniowy"]);

    const overlaps = (a, b) => !(
        a.right <= b.left + 1
        || a.bottom <= b.top + 1
        || b.right <= a.left + 1
        || b.bottom <= a.top + 1
    );
    const modesAndSalary = async () => page.evaluate(() => {
        const rect = (element) => {
            const box = element.getBoundingClientRect();
            return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
        };
        return {
            mode: rect(
                document.querySelector('input[name="wzB2bSalaryMode"][value="gross"]')
                    .closest(".segmented")
            ),
            salary: rect(document.querySelector("#wzB2bSalary").closest(".wz-slider")),
        };
    });

    const desktop = await modesAndSalary();
    expect(overlaps(desktop.mode, desktop.salary)).toBe(false);
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const mobile = await modesAndSalary();
    expect(overlaps(mobile.mode, mobile.salary)).toBe(false);
    await expectNoHorizontalOverflow(page);

    const tooltipTransform = await page.locator(".wz-panel-title .tooltip").first().evaluate(
        (el) => getComputedStyle(el).textTransform
    );
    expect(tooltipTransform).toBe("none");
});
