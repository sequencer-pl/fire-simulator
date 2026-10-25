import { test, expect } from "@playwright/test";

test("oryginalna ikona ? nadal pokazuje dymek po najechaniu", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });

    const field = page.locator(".config-field").filter({
        has: page.locator(".config-field-label", { hasText: "Inflacja roczna" }),
    }).first();
    const tip = field.locator(".tip");
    expect(await tip.evaluate((element) => element.firstChild.textContent)).toBe("?");
    await tip.hover();
    await expect(tip.locator(".tooltip")).toBeVisible();
});

test("edycja zastępuje wartość w tym samym miejscu i przywraca wartość presetu", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });

    const field = page.locator(".config-field").filter({
        has: page.locator(".config-field-label", { hasText: "Inflacja roczna" }),
    }).first();
    const value = field.locator(".config-readonly-value");
    const input = field.locator(".config-inline-editor input");
    const editor = field.locator(".config-inline-editor");
    const action = field.locator(".config-edit-btn");
    const row = field.locator(".config-readonly-row");
    const pageRect = (locator) => locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height };
    });
    const valueRect = await pageRect(value);
    const originalRect = await pageRect(action);
    const rowRect = await pageRect(row);

    await action.click();
    await expect(value).toBeHidden();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("2.5");
    const confirm = field.locator(".config-confirm-btn");
    const actions = field.locator(".config-edit-actions");
    await expect(confirm).toHaveText("OK");
    const actionsRect = await pageRect(actions);
    const editorRect = await pageRect(editor);
    const inputRect = await pageRect(input);
    const editingRowRect = await pageRect(row);
    expect(originalRect?.width).toBe(72);
    expect(actionsRect?.width).toBe(96);
    expect(editingRowRect).toEqual(rowRect);
    expect(editorRect?.x).toBe(valueRect?.x);
    expect(editorRect?.y).toBe(valueRect?.y);
    expect(editorRect?.width).toBe(valueRect?.width);
    expect(editorRect?.height).toBe(valueRect?.height);
    expect(inputRect?.width).toBeGreaterThan(page.viewportSize().width < 500 ? 100 : 130);

    await input.fill("3.5");
    await expect(field.locator(".config-override-indicator")).toBeVisible();
    await expect(field).toHaveClass(/has-override/);
    await expect(field.locator(".config-restore-btn")).toBeEnabled();
    await expect(value).toHaveText("3,5%");
    await confirm.click();
    await expect(value).toBeVisible();
    await expect(action).toHaveText("Zmień");

    await action.click();
    await field.locator(".config-restore-btn").click();
    await expect(input).toHaveValue("2.5");
    await expect(field.locator(".config-override-indicator")).toBeHidden();
    await field.locator(".config-confirm-btn").click();
    await expect(value).toHaveText("2,5%");
});

test("siatki konfiguracji mają najwyżej trzy kolumny", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    const columnCounts = await page.locator(".config-fields, .config-accounts").evaluateAll((grids) =>
        grids.map((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length)
    );
    expect(columnCounts.length).toBeGreaterThan(0);
    expect(Math.max(...columnCounts)).toBeLessThanOrEqual(3);
    if (page.viewportSize().width >= 1100) expect(Math.max(...columnCounts)).toBe(3);
});

test("pasek presetów jest zwarty na desktopie i mobile", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    const bar = page.locator(".preset-bar");
    const label = page.locator(".preset-current label");
    const select = page.locator("#presetSelect");
    const desktop = page.viewportSize().width >= 1100;

    if (desktop) {
        const [labelBox, selectBox] = await Promise.all([label.boundingBox(), select.boundingBox()]);
        const labelCenter = (labelBox?.y ?? 0) + (labelBox?.height ?? 0) / 2;
        const selectCenter = (selectBox?.y ?? 0) + (selectBox?.height ?? 0) / 2;
        expect(Math.abs(labelCenter - selectCenter)).toBeLessThanOrEqual(1);
        expect(parseFloat(await bar.evaluate((element) => getComputedStyle(element).height))).toBeLessThan(80);
    } else {
        expect(parseFloat(await bar.evaluate((element) => getComputedStyle(element).height))).toBeLessThan(150);
        const columns = await page.locator(".preset-actions").evaluate((element) =>
            getComputedStyle(element).gridTemplateColumns.split(" ").length
        );
        if (page.viewportSize().width >= 361) expect(columns).toBe(3);

        await page.setViewportSize({ width: 320, height: 740 });
        const [narrowLabelBox, narrowSelectBox] = await Promise.all([label.boundingBox(), select.boundingBox()]);
        expect(narrowSelectBox.y).toBeGreaterThan(narrowLabelBox.y);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    }
});

test("ikony opisów są wyrównane do prawej krawędzi etykiet", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    const offsets = await page.locator("#config-content > .config-section:first-child .config-field-label").evaluateAll((labels) =>
        labels.filter((label) => label.querySelector(".tip")).map((label) => {
            const labelRect = label.getBoundingClientRect();
            const tipRect = label.querySelector(".tip").getBoundingClientRect();
            return Math.abs(labelRect.right - tipRect.right);
        })
    );
    expect(offsets.length).toBeGreaterThan(0);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(1);
});

test("zmiana presetu potwierdza usunięcie indywidualnych nadpisań", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    page.on("dialog", (dialog) => dialog.accept());

    const field = page.locator(".config-field").filter({
        has: page.locator(".config-field-label", { hasText: "Inflacja roczna" }),
    }).first();
    await field.locator(".config-edit-btn").click();
    await field.locator(".config-inline-editor input").fill("4");
    await expect(field.locator(".config-override-indicator")).toBeVisible();

    await page.locator("#presetSelect").selectOption({ label: "Konserwatywne" });
    await expect(page.locator("#presetSelect")).toHaveValue("Konserwatywne");
    await expect(page.locator(".config-field").filter({
        has: page.locator(".config-field-label", { hasText: "Inflacja roczna" }),
    }).locator(".config-override-indicator")).toBeHidden();
});

test("karty reguł kont są zwinięte domyślnie na mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });

    const broker = page.locator(".account-rules-card").filter({ hasText: "Broker" }).first();
    await expect(broker).not.toHaveAttribute("open", "");
    await expect(broker.locator(".config-field").first()).toBeHidden();
    await broker.locator("summary").click();
    await expect(broker).toHaveAttribute("open", "");
    await expect(broker.locator(".config-field").first()).toBeVisible();
});

test("przycisk dodaje konto do etapu", async ({ page }) => {
    await page.goto("/sim", { waitUntil: "networkidle" });
    await page.locator("#addAccumulationBtn").click();

    const broker = page.locator('.account-toggle[data-account="broker"]');
    await broker.click();
    await expect(broker).toHaveClass(/active/);
    await expect(page.locator('.account-card[data-account="broker"]')).toBeVisible();
});

test("karty kont zachowują szerokość kolumn, a ? nie nachodzi na usuwanie", async ({ page }) => {
    await page.goto("/sim", { waitUntil: "networkidle" });
    await page.locator("#addAccumulationBtn").click();

    const stage = page.locator(".stage-block").first();
    await stage.locator('.account-toggle[data-account="broker"]').click();
    const grid = stage.locator(".accounts-grid");
    const broker = grid.locator('.account-card[data-account="broker"]');
    const singleWidth = await broker.evaluate((card) => card.getBoundingClientRect().width);

    const heading = broker.locator(".account-card-header h4");
    const tip = heading.locator(".tip");
    const close = broker.locator(".remove-account-btn");
    const geometry = await Promise.all([
        tip.evaluate((element) => element.getBoundingClientRect().right),
        close.evaluate((element) => element.getBoundingClientRect().left),
    ]);
    expect(geometry[0]).toBeLessThanOrEqual(geometry[1]);

    const field = broker.locator(".field-group").filter({ has: page.locator(".tip") }).first();
    const fieldGeometry = await Promise.all([
        field.locator("label .tip").evaluate((element) => element.getBoundingClientRect().right),
        field.locator(".num-control").evaluate((element) => element.getBoundingClientRect().right),
    ]);
    expect(Math.abs(fieldGeometry[0] - fieldGeometry[1])).toBeLessThanOrEqual(1);

    if (page.viewportSize().width >= 769) {
        await stage.locator('.account-toggle[data-account="ike"]').click();
        await stage.locator('.account-toggle[data-account="krypto"]').click();
        const widths = await grid.locator(".account-card").evaluateAll((cards) =>
            cards.map((card) => card.getBoundingClientRect().width)
        );
        expect(widths).toHaveLength(3);
        expect(Math.abs(singleWidth - widths[0])).toBeLessThanOrEqual(1);
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    }
});
