import { test, expect } from "@playwright/test";

// Konfiguracja edytuje w miejscu (DESIGN.md §1.6): pole liczbowe widoczne od razu,
// kropka przy etykiecie i aktywny „przywróć” sygnalizują wartość inną niż w presecie.

const field = (page, label) =>
    page.locator(".config-field").filter({
        has: page.locator(".config-field-label", { hasText: label }),
    }).first();

test("ikona ? pokazuje dymek po najechaniu", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    const tip = field(page, "Inflacja roczna").locator(".tip");
    expect(await tip.evaluate((element) => element.firstChild.textContent)).toBe("?");
    await tip.hover();
    await expect(tip.locator(".tooltip")).toBeVisible();
});

test("pole jest edytowalne od razu, zmiana zaznacza nadpisanie, przywróć wraca do presetu", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    const f = field(page, "Inflacja roczna");
    const input = f.locator(".config-inline-editor input");
    const restore = f.locator(".config-restore-btn");
    const indicator = f.locator(".config-override-indicator");

    await expect(input).toBeVisible();
    await expect(input).toHaveValue("2.5");
    await expect(f.locator(".config-edit-btn")).toHaveCount(0);
    await expect(indicator).toBeHidden();
    await expect(restore).toBeDisabled();

    await input.fill("3.5");
    await expect(indicator).toBeVisible();
    await expect(f).toHaveClass(/has-override/);
    await expect(restore).toBeEnabled();

    await restore.click();
    await expect(input).toHaveValue("2.5");
    await expect(indicator).toBeHidden();
    await expect(restore).toBeDisabled();
});

test("select konfiguracji jest natywnym <select> z klasą .select", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    const f = field(page, "Model podatkowy");
    // Na wąskim ekranie karty reguł kont są domyślnie zwinięte.
    await f.evaluate((el) => { const d = el.closest("details"); if (d) d.open = true; });
    const select = f.locator("select.select");
    await expect(select).toBeVisible();
    await select.selectOption("none");
    await expect(f).toHaveClass(/has-override/);
});

test("„Usuń preset” jest ukryty dla wbudowanego presetu", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    await expect(page.locator("#presetDeleteBtn")).toBeHidden();
});

test("„Przywróć domyślne” wymaga potwierdzenia", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    const f = field(page, "Inflacja roczna");
    const input = f.locator(".config-inline-editor input");
    await input.fill("3.5");

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.locator("#configResetBtn").click();
    await expect(input).toHaveValue("3.5");

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#configResetBtn").click();
    await expect(input).toHaveValue("2.5");
});
