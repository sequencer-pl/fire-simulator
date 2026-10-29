import { test, expect } from "@playwright/test";

test("wiek końca musi być większy niż wiek start", async ({ page }) => {
    await page.goto("/sim", { waitUntil: "networkidle" });
    await page.locator("#emptyAddAccumulationBtn").click();
    const block = page.locator(".stage-block").first();
    await block.locator(".start-age").fill("50");
    await block.locator(".end-age").fill("40");

    await expect(page.locator("#simulateBtn")).toBeDisabled();
    await expect(block.locator(".stage-hint")).toContainText(
        "Wiek końca musi być większy niż wiek start."
    );
});

test("import symulacji jest widoczny i nie rozpycha paska akcji", async ({ page }) => {
    await page.goto("/sim", { waitUntil: "networkidle" });
    const btn = page.locator("#importSimBtn");
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute("aria-label", "Importuj symulację z pliku JSON");

    const bar = page.locator("#formActions");
    const barBox = await bar.boundingBox();
    const btnBox = await btn.boundingBox();
    expect(btnBox).not.toBeNull();
    expect(btnBox.x).toBeGreaterThanOrEqual(barBox.x - 0.5);
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(barBox.x + barBox.width + 0.5);
    expect(await bar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);

    // Na telefonie zostaje sama ikona (34×34), na większym ekranie tekst.
    const labelDisplay = await btn.locator(".import-label").evaluate((el) => getComputedStyle(el).display);
    const width = page.viewportSize().width;
    if (width <= 640) {
        expect(labelDisplay).toBe("none");
        expect(Math.round(btnBox.width)).toBe(34);
    } else {
        expect(labelDisplay).not.toBe("none");
    }

    // 320 px: wszystkie cztery przyciski muszą się zmieścić bez nachodzenia na siebie.
    await page.setViewportSize({ width: 320, height: 844 });
    const narrow = await page.evaluate(() => {
        const bar = document.getElementById("formActions");
        const btns = [...bar.querySelectorAll(".btn")].filter((el) => el.getBoundingClientRect().width > 0);
        const rects = btns.map((el) => el.getBoundingClientRect());
        return {
            overflow: bar.scrollWidth - bar.clientWidth,
            clipped: btns.some((el) => el.scrollWidth > el.clientWidth + 1),
            overlap: rects.some((r, i) => i > 0 && r.left < rects[i - 1].right - 0.5),
        };
    });
    expect(narrow.overflow).toBeLessThanOrEqual(1);
    expect(narrow.clipped).toBe(false);
    expect(narrow.overlap).toBe(false);
});

test("nazwa etapu z importu jest escapowana", async ({ page }) => {
    await page.goto("/sim", { waitUntil: "networkidle" });
    const evil = '"><img src=x onerror=alert(1)>';
    const payload = {
        name: "xss",
        input: {
            stages: [
                {
                    stage_type: "akumulacja",
                    name: evil,
                    start_age: 40,
                    end_age: 41,
                    accounts: { broker: { starting_balance: 1000, roi: 0.0 } },
                },
            ],
            max_age: 100,
            gender: "m",
            monthly_gross: 0,
            inflation: null,
        },
    };

    let dialogSeen = false;
    page.on("dialog", async (dialog) => {
        dialogSeen = true;
        await dialog.dismiss();
    });

    await page.setInputFiles("#importSimInput", {
        name: "xss.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(payload)),
    });
    await page.locator("#simulateBtn").click();
    await expect(page.locator("#results")).toBeVisible();

    await expect(page.locator(".stage-block .stage-name").first()).toHaveValue(evil);
    await expect(page.locator("#resultsTable td.col-stage").first()).toContainText("<img");
    expect(dialogSeen).toBe(false);
});
