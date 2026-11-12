import { test, expect } from "@playwright/test";

async function goToStep3(page) {
    await page.goto("/wizard-v1", { waitUntil: "networkidle" });
    await page.locator("#wzNextBtn").click();
    await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step="3"]')).toBeVisible();
}

test("krok 3: focus zaznacza 0, wpisanie 1000 nie daje 01000", async ({ page }) => {
    await goToStep3(page);
    await page.locator('.wz-pill[data-account="broker"]').click();

    const input = page.locator('.wz-capital-input[data-account="broker"]');
    await expect(input).toHaveValue("0");
    await input.focus();
    await page.keyboard.type("1000");
    await expect(input).toHaveValue("1000");
});

test("krok 3: konta są nad pickerem, nowe ląduje tuż nad nim", async ({ page }) => {
    await goToStep3(page);

    const layout = await page.evaluate(() => {
        const grid = document.getElementById("wzCapitalGrid");
        const pickerPanel = document.getElementById("wzCapitalPicker").closest(".wz-panel");
        return {
            gridBeforePicker:
                (grid.compareDocumentPosition(pickerPanel) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
            emptyHintVisible: !document.getElementById("wzCapitalEmpty").hidden,
        };
    });
    expect(layout.gridBeforePicker).toBe(true);
    expect(layout.emptyHintVisible).toBe(true);

    await page.locator('.wz-pill[data-account="broker"]').click();
    await page.locator('.wz-pill[data-account="lokata"]').click();
    await expect(page.locator("#wzCapitalEmpty")).toBeHidden();

    const rows = await page.locator("#wzCapitalGrid .wz-capital-item").evaluateAll((els) =>
        els.map((el) => el.dataset.account)
    );
    expect(rows).toEqual(["broker", "lokata"]);
});

test("krok 5: nota sugeruje IKE jako cel zwrotu IKZE", async ({ page }) => {
    let planCalls = 0;
    page.on("request", (req) => {
        if (req.url().includes("/api/wizard/plan")) planCalls += 1;
    });
    await page.goto("/wizard-v1", { waitUntil: "networkidle" });
    for (let i = 0; i < 4; i += 1) await page.locator("#wzNextBtn").click();
    await expect(page.locator('.wz-step[data-step="5"]')).toBeVisible();

    await page.locator('label:has(input[name="wzStrategy"][value="zbilansowana"])').click();
    await expect(page.locator("#wzAllocRefundNote")).toContainText("Zwrot IKZE automatycznie zasili IKE");

    await page.locator("#wzNextBtn").click();
    const earlyChip = page
        .locator(".wz-fact-row .wz-fact")
        .filter({ hasText: "Wcześniejszy zwrot IKZE" });
    await expect(earlyChip).toBeVisible({ timeout: 30_000 });
    await expect(earlyChip.locator(".tooltip")).toContainText("reinwestycja");
    await expect(
        page.locator(".wz-fact-row .wz-fact").filter({ hasText: "Ulga IKZE:" })
    ).toBeVisible();
    await expect(page.locator("#wzFlowsWrap")).toBeVisible();
    await expect(page.locator("#wzFlowsWrap .wz-panel-title .tooltip")).toContainText("Litera");
    await expect(page.locator("#wzFlowsTable tbody tr")).toHaveCount(6);
    await expect(page.locator("#wzFlowsTable thead")).toContainText("Podatki i składki");
    const zusRow = page
        .locator("#wzFlowsTable tbody tr")
        .filter({ hasText: "ZUS (emerytura)" });
    const zusTax = zusRow.locator(".wz-flow-tax-cell .tip");
    await expect(zusTax.locator(".tooltip")).toContainText("zdrowotna");
    await expect(zusRow.locator(".wz-flow-tax-main")).not.toContainText("zdrowotna");
    await zusTax.hover();
    await expect(zusTax.locator(".tooltip")).toBeVisible();
    // Długie „PIT … + zdrowotna …” nie mogą być ucinane przez obudowę tabeli.
    const tableWrapOverflow = await page
        .locator("#wzFlowsTable")
        .evaluate((el) => getComputedStyle(el.parentElement).overflow);
    expect(tableWrapOverflow).toBe("visible");
    await expect(page.locator("#wzFlowsGantt .wz-gantt-row:not(.wz-gantt-total)")).toHaveCount(3);
    await expect(page.locator("#wzFlowsGantt .wz-gantt-total")).toContainText("Razem");
    await expect(page.locator("#wzFlowsTotal")).toContainText("Łącznie wypłacono netto");

    // Tooltip akumulacji: tap/klik pokazuje szczegóły etapu, Escape zamyka.
    // Na mobile wykres zaczyna się od pierwszej wypłaty, więc pasek akumulacji
    // może być poza zakresem — test go, gdy istnieje.
    if ((await page.locator("#wzFlowsGantt .wz-gantt-accum").count()) > 0) {
        await page.locator("#wzFlowsGantt .wz-gantt-accum").first().click();
        await expect(page.locator("#wzGanttTip")).toBeVisible();
        await expect(page.locator("#wzGanttTip")).toContainText("Kapitał startowy");
        await expect(page.locator("#wzGanttTip")).toContainText("Wpłaty");
        await page.keyboard.press("Escape");
        await expect(page.locator("#wzGanttTip")).toBeHidden();
    }

    // Tooltip fazy realizacji: kwoty z „zł”.
    await page.locator("#wzFlowsGantt .wz-gantt-phase:not(.is-total)").first().click();
    await expect(page.locator("#wzGanttTip")).toBeVisible();
    await expect(page.locator("#wzGanttTip")).toContainText("Razem netto");
    await expect(page.locator("#wzGanttTip")).toContainText("zł");
    await page.keyboard.press("Escape");
    await expect(page.locator("#wzGanttTip")).toBeHidden();

    await page.locator(".wz-method-details summary").click();
    await expect(page.locator("#wzPolicyNote")).toContainText("Kolejność wypłat");
    await expect(page.locator("#wzNextBtn")).toHaveText("Dostosuj w symulatorze");
    await expect(page.locator("#wzNextBtn")).toHaveClass(/btn-real/);

    // Wybrana polityka przechodzi do edytora razem z draftem.
    await page.locator("#wzNextBtn").click();
    await page.waitForURL("**/sim?wizard=1");
    await expect
        .poll(() => page.evaluate(() => gatherFormData().withdrawal_policy))
        .toMatch(/^early_/);
    // Draft z Asystenta od razu pokazuje wynik — bez drugiego kliknięcia „Symuluj”.
    await expect(page.locator("#results")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#simulateBtn")).toBeHidden();
    await expect(page.locator("#editConfigBtn")).toBeVisible();
    await expect(page.locator("#backToWizardBtn")).toBeVisible();
    await expect(page.locator("#backToWizardBtn")).toHaveAttribute(
        "href",
        "/wizard-v1?restore=1"
    );
    await expect(page.locator("#results")).toContainText("Broker");
    // Pasek wyników: eksport/zapis po lewej, powrót/edycja po prawej.
    await expect(page.locator("#formActions .action-bar-left #exportSimBtn")).toBeVisible();
    await expect(page.locator("#formActions .action-bar-left #saveSimBtn")).toBeVisible();
    await expect(page.locator("#formActions .action-bar-right #backToWizardBtn")).toBeVisible();
    await expect(page.locator("#formActions .action-bar-right #editConfigBtn")).toBeVisible();

    // W trybie edycji etapów powrót jest w banerze, a pasek nie pęka na mobile.
    await page.locator("#editConfigBtn").click();
    await expect(page.locator("#simConfigSection")).not.toHaveClass(/collapsed/);
    await expect(page.locator("#backToWizardBtn")).toBeHidden();
    await expect(page.locator("#simulateBtn")).toBeVisible();
    await page.locator("#simulateBtn").click();
    await expect(page.locator("#results")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#backToWizardBtn")).toBeVisible();

    // Powrót ma odtworzyć krok 6 z gotowym wynikiem, bez nowego planu.
    const planCallsBeforeReturn = planCalls;
    await page.locator("#backToWizardBtn").click();
    await page.waitForURL("**/wizard-v1?restore=1");
    await expect(page.locator('.wz-step[data-step="6"]')).toBeVisible();
    await expect(page.locator("#wzResult")).toBeVisible();
    await expect(page.locator("#wzStepCount")).toHaveText("Krok 6 / 6");
    await expect(page.locator("#wzNextBtn")).toHaveText("Dostosuj w symulatorze");
    expect(planCalls).toBe(planCallsBeforeReturn);

    // Tabela przepływów nie może wyjeżdżać poza ekran w przedziale tabletowym.
    await page.setViewportSize({ width: 920, height: 900 });
    await page.locator("#wzFlowsWrap").scrollIntoViewIfNeeded();
    await expect(page.locator("#wzFlowsTable tbody tr").first()).toHaveCSS("display", "block");
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
});
