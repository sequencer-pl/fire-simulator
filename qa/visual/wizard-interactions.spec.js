import { test, expect } from "@playwright/test";

async function goToStep3(page) {
    await page.goto("/wizard", { waitUntil: "networkidle" });
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
    await page.goto("/wizard", { waitUntil: "networkidle" });
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
    await expect(page.locator(".wz-flows-legend")).toContainText("Litera");
    await expect(page.locator("#wzFlowsTable tbody tr")).toHaveCount(6);
    await expect(page.locator("#wzFlowsTable thead")).toContainText("Podatki i składki");
    await expect(
        page.locator("#wzFlowsTable tbody tr").filter({ hasText: "ZUS (emerytura)" })
    ).toContainText("zdrowotna");
    await expect(page.locator("#wzFlowsGantt .wz-gantt-row:not(.wz-gantt-total)")).toHaveCount(3);
    await expect(page.locator("#wzFlowsGantt .wz-gantt-total")).toContainText("Razem");
    await expect(page.locator("#wzFlowsTotal")).toContainText("Łącznie wypłacono netto");

    await page.locator(".wz-method-details summary").click();
    await expect(page.locator("#wzPolicyNote")).toContainText("Kolejność wypłat");

    // Wybrana polityka przechodzi do edytora razem z draftem.
    await page.locator("#wzNextBtn").click();
    await page.waitForURL("**/sim?wizard=1");
    await expect
        .poll(() => page.evaluate(() => gatherFormData().withdrawal_policy))
        .toMatch(/^early_/);
    // Draft z wcześniejszym zwrotem IKZE ma być od razu symulowalny
    // (konto docelowe dołożone do etapów, auto jako cel zwrotu).
    await expect(page.locator("#simulateBtn")).toBeEnabled();
    await page.locator("#simulateBtn").click();
    await expect(page.locator("#results")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#results")).toContainText("Broker");
});
