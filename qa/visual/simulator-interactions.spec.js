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
