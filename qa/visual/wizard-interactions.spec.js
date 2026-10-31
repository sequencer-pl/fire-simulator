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
});
