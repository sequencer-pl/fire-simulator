import fs from "node:fs";
import { test, expect } from "@playwright/test";

async function expectNoHorizontalOverflow(page) {
    const dimensions = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
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

        if (step === 8) {
            await page.waitForFunction(() => {
                const list = document.getElementById("wzSuggestList");
                return list
                    && !list.querySelector(".spinner")
                    && Boolean(list.querySelector(".wz-suggest-row, .wz-suggest-empty, .banner"));
            });
        }
        await page.locator("#wzNextBtn").click();
    }

    await expect(page.locator("#wzStepCount")).toHaveText("Krok 9 / 9");
    await expect(page.locator("#wzResult")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#wzHeroAnswer")).not.toBeEmpty();
    await expect(page.locator("#wzScenariosBox .wz-scenario-card")).toHaveCount(3);
    await page.locator(".wz-result-details summary").click();
    await expect(page.locator("#wzAccountFlows .wz-flows-table")).toBeVisible();
    await expect(page.locator("#wzAccountFlows tbody tr").first()).toBeVisible();
    await expect(page.locator("#wzFlowsGantt .wz-gantt-row").first()).toBeAttached();
    await expect(page.locator("#wzPolicyNote")).toContainText("Kolejność wypłat");
    await expectNoHorizontalOverflow(page);

    const answerBeforeReturn = await page.locator("#wzHeroAnswer").evaluate((el) =>
        el.textContent.replace(/\s+/g, " ").trim()
    );
    await page.locator("#wzNextBtn").click();
    await page.waitForURL("**/sim?wizard=1");
    await expect(page.locator("#results")).toBeVisible({ timeout: 30_000 });
    await page.locator("#backToWizardBtn").click();
    await page.waitForURL("**/wizard?restore=1");
    await expect(page.locator("#wzResult")).toBeVisible();
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
    await page.goto("/wizard", { waitUntil: "networkidle" });
    for (let step = 1; step < 8; step += 1) await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step-id="strategia"]')).toBeVisible();
    await page.waitForFunction(() => {
        const list = document.getElementById("wzSuggestList");
        return list
            && !list.querySelector(".spinner")
            && Boolean(list.querySelector(".wz-suggest-row, .wz-suggest-empty, .banner"));
    });

    await page.locator('label:has(input[name="wzAllocationMode"][value="manual"])').click();
    await expect(page.locator(".wz-manual-alloc-row:not(.wz-manual-cash-row)")).toHaveCount(9);
    await expect(page.locator(".wz-manual-cash-row")).toBeVisible();
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
    await expect(page.locator("#wzResult")).toBeVisible({ timeout: 30_000 });
    expect(submittedAllocations).toEqual({ broker: 70, lokata: 30 });

    await expect(page.locator("#wzExportBtn")).toBeVisible();
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

test("manual split prevents totals above 100% and exposes sliders and cash row", async ({ page }) => {
    await page.goto("/wizard", { waitUntil: "networkidle" });
    for (let step = 1; step < 8; step += 1) await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step-id="strategia"]')).toBeVisible();
    await page.waitForFunction(() => {
        const list = document.getElementById("wzSuggestList");
        return list
            && !list.querySelector(".spinner")
            && Boolean(list.querySelector(".wz-suggest-row, .wz-suggest-empty, .banner"));
    });
    await page.locator('label:has(input[name="wzAllocationMode"][value="manual"])').click();
    await expect(page.locator(".wz-manual-share-range")).toHaveCount(9);
    await expect(page.locator("#wzIkzeRefundNote")).toBeVisible();

    const shares = page.locator(".wz-manual-share");
    for (let index = 0; index < await shares.count(); index += 1) await shares.nth(index).fill("0");
    await expect(page.locator("#wzIkzeRefundNote")).toBeHidden();
    await page.locator('.wz-manual-share[data-account="broker"]').fill("80");
    await page.locator('.wz-manual-share[data-account="lokata"]').fill("50");

    await expect(page.locator('.wz-manual-share[data-account="lokata"]')).toHaveValue("20");
    await expect(page.locator("#wzManualSum")).toContainText("Suma udziałów: 100%");
    await expect(page.locator(".wz-manual-cash-row")).toContainText("0 zł/mies.");
    await expect(page.locator(".wz-manual-cash-row")).toHaveClass(/is-clear/);

    await page.locator('.wz-manual-share[data-account="lokata"]').fill("10");
    await expect(page.locator("#wzManualSum")).toContainText("Suma udziałów: 90%");
    await expect(page.locator(".wz-manual-cash-row")).toHaveClass(/is-warning/);
    await expectNoHorizontalOverflow(page);
});

test("strategy cards collapse when every strategy gives the same split", async ({ page }) => {
    await page.goto("/wizard", { waitUntil: "networkidle" });
    for (let step = 1; step < 5; step += 1) await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step-id="oszczednosci"]')).toBeVisible();
    await page.locator("#wzSavings").fill("500");
    await page.locator("#wzSavings").dispatchEvent("input");
    for (let step = 5; step < 8; step += 1) await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step-id="strategia"]')).toBeVisible();
    await page.waitForFunction(() => {
        const list = document.getElementById("wzSuggestList");
        return list
            && !list.querySelector(".spinner")
            && Boolean(list.querySelector(".wz-suggest-row, .wz-suggest-empty, .banner"));
    });
    await expect(page.locator(".wz-strategy-card:not([hidden])")).toHaveCount(1);
    await expect(page.locator("#wzStrategyHint")).toContainText("wszystkie strategie dają ten sam podział");
    await expect(page.locator("#wzStrategyShowAll")).toBeVisible();
    const visibleCard = page.locator(".wz-strategy-card:not([hidden])");
    await expect(visibleCard.locator(".wz-strategy-rank-row")).toHaveCount(5);
    await expect(visibleCard.locator(".wz-strategy-more")).toContainText("…i 2 dalsze");
    await expect(visibleCard).not.toContainText("%");
    await expect(page.locator("#wzIkzeRefundNote")).toBeVisible();
    await expect(page.locator("#wzIkzeRefundNote")).toContainText("Ulga IKZE wraca co roku");
    await expect(page.locator("#wzIkzeRefundNote .tooltip")).toContainText("IKE → OIPE");
    await expect(page.locator("#wzTaxTipNote")).toContainText("Pula:");
    const notePlacement = await page.evaluate(() => {
        const note = document.getElementById("wzTaxTipNote");
        const list = document.getElementById("wzSuggestList");
        return {
            beforeList: Boolean(
                note.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING
            ),
            border: getComputedStyle(note).borderTopWidth,
        };
    });
    expect(notePlacement.beforeList).toBe(true);
    expect(notePlacement.border).toBe("1px");
    await page.locator("#wzStrategyShowAll").click();
    await expect(page.locator(".wz-strategy-card:not([hidden])")).toHaveCount(3);

    const widths = await page.locator(".wz-strategy-card:not([hidden])").evaluateAll((cards) =>
        cards.map((card) => card.getBoundingClientRect().width)
    );
    if (page.viewportSize().width > 700) {
        expect(widths.every((width) => Math.abs(width - 320) <= 1)).toBe(true);
    } else {
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    }
    await expectNoHorizontalOverflow(page);
});

test("manual split seeded from many accounts never exceeds 100%", async ({ page }) => {
    await page.goto("/wizard", { waitUntil: "networkidle" });
    for (let step = 1; step < 8; step += 1) await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step-id="strategia"]')).toBeVisible();
    await page.waitForFunction(() => {
        const list = document.getElementById("wzSuggestList");
        return list
            && !list.querySelector(".spinner")
            && Boolean(list.querySelector(".wz-suggest-row, .wz-suggest-empty, .banner"));
    });
    await page.evaluate(() => {
        wzSuggested.allocations = {
            ikze: 9.42, ike: 23.55, oipe: 23.55, broker: 19.57,
            obligacje: 10.87, oki_inw: 6.52, lokata: 4.35, krypto: 2.17,
        };
        wzSuggested.pool_monthly = 10_000;
        wzManualAllocations = null;
    });
    await page.locator('label:has(input[name="wzAllocationMode"][value="manual"])').click();
    const total = await page.locator(".wz-manual-share").evaluateAll((inputs) =>
        inputs.reduce((sum, input) => sum + (parseFloat(input.value) || 0), 0)
    );
    expect(total).toBeCloseTo(100, 5);
    await expect(page.locator("#wzManualSum")).toContainText("Suma udziałów: 100%");
    await expectNoHorizontalOverflow(page);
});

test("manual split absorbs tiny cap overflow instead of showing cash warning", async ({ page }) => {
    await page.goto("/wizard", { waitUntil: "networkidle" });
    for (let step = 1; step < 8; step += 1) await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step-id="strategia"]')).toBeVisible();
    await page.waitForFunction(() => {
        const list = document.getElementById("wzSuggestList");
        return list
            && !list.querySelector(".spinner")
            && Boolean(list.querySelector(".wz-suggest-row, .wz-suggest-empty, .banner"));
    });
    await page.evaluate(() => {
        wzSuggested.allocations = { ike: 51.2, ikze: 20.5, broker: 28.3 };
        wzSuggested.pool_monthly = 4600;
        wzManualAllocations = null;
    });
    await page.locator('label:has(input[name="wzAllocationMode"][value="manual"])').click();
    await expect(page.locator("#wzManualSum")).toContainText("Suma udziałów: 100%");
    await expect(page.locator("#wzManualSum")).not.toContainText("nadwyżka");
    await expect(page.locator(".wz-manual-cash-row")).not.toHaveClass(/is-warning/);
    await expect(page.locator(".wz-manual-cash-row")).toContainText("0 zł/rok");
    await expect(page.locator('.wz-manual-alloc-row[data-account="broker"] .wz-manual-annual')).toContainText(/15\s*636/);
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
            && Boolean(list.querySelector(".wz-suggest-row, .wz-suggest-empty, .banner"));
    });

    await page.locator('label:has(input[name="wzAllocationMode"][value="manual"])').click();
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

test("ZUS and OFE capital fields fit large values and stay responsive", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/wizard", { waitUntil: "networkidle" });
    for (let step = 0; step < 3; step += 1) await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step-id="zus"]')).toBeVisible();
    await page.locator('label:has(input[name="wzHasZusCap"][value="yes"])').click();
    await page.locator('label:has(input[name="wzHasOfe"][value="yes"])').click();

    const desktopLayout = await page.locator(".wz-zus-cap-grid").evaluate((grid) => {
        const control = grid.querySelector(".num-control").getBoundingClientRect();
        const input = grid.querySelector("input[type=number]").getBoundingClientRect();
        return { controlWidth: control.width, inputWidth: input.width };
    });
    expect(desktopLayout.controlWidth).toBeGreaterThanOrEqual(190);
    expect(desktopLayout.inputWidth).toBeGreaterThanOrEqual(90);
    await expect(page.locator("#wzOfeCapBox")).toBeVisible();
    await page.locator("#wzZusBalance").fill("800000");
    await page.locator("#wzOfeBalance").fill("300000");
    await expect(page.locator("#wzZusBalance")).toHaveValue("800000");
    await expect(page.locator("#wzOfeBalance")).toHaveValue("300000");
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#wzOfeCapBox")).toBeVisible();
    await expectNoHorizontalOverflow(page);
});

test("real-estate controls use balanced columns and a wide value input", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/wizard", { waitUntil: "networkidle" });
    for (let step = 1; step < 6; step += 1) await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step-id="kapital"]')).toBeVisible();
    await page.locator('label:has(input[name="wzHasRealEstate"][value="yes"])').click();
    await expect(page.locator("#wzRealEstateBox")).toBeVisible();

    const desktopLayout = await page.locator(".wz-real-estate-grid").evaluate((grid) => {
        const fields = [...grid.querySelectorAll(":scope > .wz-field-block")];
        const rects = fields.map((field) => field.getBoundingClientRect());
        const number = grid.querySelector("#wzReValue");
        return {
            firstWidth: rects[0].width,
            secondWidth: rects[1].width,
            thirdWidth: rects[2].width,
            controlWidth: number.closest(".num-control").getBoundingClientRect().width,
            inputWidth: number.getBoundingClientRect().width,
        };
    });
    expect(Math.abs(desktopLayout.firstWidth - desktopLayout.secondWidth)).toBeLessThanOrEqual(1);
    expect(desktopLayout.thirdWidth).toBeGreaterThan(desktopLayout.firstWidth * 1.9);
    expect(desktopLayout.controlWidth).toBeGreaterThanOrEqual(220);
    expect(desktopLayout.inputWidth).toBeGreaterThanOrEqual(120);
    await page.locator("#wzReValue").fill("3000000");
    await expect(page.locator("#wzReValue")).toHaveValue("3000000");
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    const stacked = await page.locator(".wz-real-estate-grid").evaluate((grid) => {
        const fields = [...grid.querySelectorAll(":scope > .wz-field-block")];
        return fields[1].getBoundingClientRect().top > fields[0].getBoundingClientRect().bottom
            && fields[2].getBoundingClientRect().top > fields[1].getBoundingClientRect().bottom;
    });
    expect(stacked).toBe(true);
    await expectNoHorizontalOverflow(page);
});

test("mortgage fields stay balanced and Coast FIRE fields stack one per row", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/wizard", { waitUntil: "networkidle" });
    for (let step = 0; step < 4; step += 1) await page.locator("#wzNextBtn").click();
    await page.locator('label:has(input[name="wzHasMortgage"][value="yes"])').click();
    const mortgageWidths = await page.locator("#wzMortgageBox .wz-grid").evaluate((grid) => {
        const fields = [...grid.querySelectorAll(":scope > .wz-field-block")];
        return fields.map((field) => field.getBoundingClientRect().width);
    });
    expect(Math.abs(mortgageWidths[0] - mortgageWidths[1])).toBeLessThanOrEqual(1);

    await page.locator("#wzNextBtn").click();
    await page.locator("#wzNextBtn").click();
    await page.locator('label:has(input[name="wzFireStyle"][value="coast"])').click();
    await expect(page.locator("#wzSemiSavingsGroup")).toBeVisible();
    const coastLayout = await page.locator("#wzSemiFireBox .wz-rows").evaluate((grid) => {
        const fields = [...grid.querySelectorAll(":scope > .wz-field-block")];
        const rects = fields.map((field) => field.getBoundingClientRect());
        return {
            widths: rects.map((rect) => rect.width),
            stacked: rects.every((rect, index) => index === 0 || rect.top >= rects[index - 1].bottom),
        };
    });
    expect(coastLayout.stacked).toBe(true);
    expect(Math.max(...coastLayout.widths) - Math.min(...coastLayout.widths)).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page);
});
