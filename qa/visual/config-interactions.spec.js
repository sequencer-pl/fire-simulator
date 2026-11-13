import { test, expect } from "@playwright/test";

// Konfiguracja edytuje w miejscu (DESIGN.md §1.6): sekcje są zwinięte,
// kropka przy etykiecie i aktywny „przywróć” sygnalizują wartość inną niż w presecie.

const field = (page, label) =>
    page.locator(".config-field").filter({
        has: page.locator(".config-field-label", { hasText: label }),
    }).first();

const section = (page, title) =>
    page.locator("details.config-section").filter({
        has: page.locator(".config-section-title", { hasText: title }),
    }).first();

async function openSection(page, title) {
    const target = section(page, title);
    if (!(await target.evaluate((element) => element.open))) {
        await target.locator(":scope > summary").click();
    }
    await expect(target).toHaveJSProperty("open", true);
}

test("sekcje startują zwinięte, przycisk rozwija i zwija wszystkie", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    const sections = page.locator("#config-content details.config-section");
    const allClosed = () => sections.evaluateAll((els) => els.every((el) => !el.open));
    const allOpen = () => sections.evaluateAll((els) => els.every((el) => el.open));
    await expect.poll(allClosed).toBe(true);

    const button = page.locator("#configExpandBtn");
    await expect(button).toHaveText("Rozwiń sekcje");
    await button.click();
    await expect.poll(allOpen).toBe(true);
    await expect(button).toHaveText("Zwiń sekcje");
    await button.click();
    await expect.poll(allClosed).toBe(true);
});

test("ikona ? pokazuje dymek po najechaniu", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    await openSection(page, "Skala podatkowa");
    const tip = field(page, "Inflacja roczna").locator(".tip");
    expect(await tip.evaluate((element) => element.firstChild.textContent)).toBe("?");
    await tip.hover();
    await expect(tip.locator(".tooltip")).toBeVisible();
});

test("pole jest edytowalne od razu, zmiana przełącza preset na Własną, przywróć wraca do presetu", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    await openSection(page, "Skala podatkowa");
    const f = field(page, "Inflacja roczna");
    const input = f.locator(".config-inline-editor input");
    const restore = f.locator(".config-restore-btn");
    const indicator = f.locator(".config-override-indicator");
    const badge = section(page, "Skala podatkowa").locator(".config-section-modified");

    await expect(input).toBeVisible();
    await expect(input).toHaveValue("2.5");
    await expect(f.locator(".config-edit-btn")).toHaveCount(0);
    await expect(indicator).toBeHidden();
    await expect(restore).toBeDisabled();
    await expect(badge).toBeHidden();

    await input.fill("3.5");
    await expect(indicator).toBeVisible();
    await expect(f).toHaveClass(/has-override/);
    await expect(restore).toBeEnabled();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("1");
    await expect(page.locator("#presetSelect option:checked")).toHaveText("Własna konfiguracja");

    await restore.click();
    await expect(input).toHaveValue("2.5");
    await expect(indicator).toBeHidden();
    await expect(restore).toBeDisabled();
    await expect(badge).toBeHidden();
    await expect(page.locator("#presetSelect option:checked")).toHaveText("Domyślne 2026");
});

test("select konfiguracji jest natywnym <select> z klasą .select", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    await openSection(page, "Konta — reguły");
    const f = field(page, "Model podatkowy");
    await f.evaluate((element) => {
        const details = element.closest("details");
        if (details) details.open = true;
    });
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
    await openSection(page, "Skala podatkowa");
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

test("eksport i import konfiguracji używają .config.json", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#presetExportBtn").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.config\.json$/);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    page.once("dialog", (dialog) => dialog.accept("Import test"));
    await page.setInputFiles("#presetImportInput", filePath);
    await expect(page.locator("#presetSelect option:checked")).toHaveText("Import test");
    await expect(page.locator("#presetDeleteBtn")).toBeVisible();
});

test("konfiguracja i presety zapisują się lokalnie między odświeżeniami", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    await openSection(page, "Skala podatkowa");
    const f = field(page, "Inflacja roczna");
    await f.locator(".config-inline-editor input").fill("3.7");
    await page.waitForFunction(() => {
        const raw = localStorage.getItem("fire.config");
        return raw && Math.abs(JSON.parse(raw).config?.inflation - 0.037) < 1e-9;
    });

    page.once("dialog", (dialog) => dialog.accept("Lokalny preset"));
    await page.locator("#presetSaveBtn").click();
    await expect(page.locator("#presetSelect option:checked")).toHaveText("Lokalny preset");

    await page.reload({ waitUntil: "networkidle" });
    await openSection(page, "Skala podatkowa");
    await expect(field(page, "Inflacja roczna").locator(".config-inline-editor input")).toHaveValue("3.7");
    await expect(page.locator("#presetSelect option:checked")).toHaveText("Lokalny preset");
    await expect(page.locator("#presetDeleteBtn")).toBeVisible();
});
