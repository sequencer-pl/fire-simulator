import { test, expect } from "@playwright/test";

function simulationPayload(name, roi, startBalance = 100_000) {
    return {
        schema: "fire-simulation/v1",
        name,
        exported_at: new Date().toISOString(),
        source: "simulator",
        input: {
            stages: [
                {
                    stage_type: "akumulacja",
                    name: "Akumulacja",
                    start_age: 40,
                    end_age: 50,
                    accounts: {
                        broker: {
                            starting_balance: startBalance,
                            roi,
                            annual_contribution: 12_000,
                        },
                    },
                },
            ],
            max_age: 50,
        },
    };
}

test("Porównywarka wczytuje .sim.json i odrzuca .config.json", async ({ page }) => {
    await page.goto("/compare", { waitUntil: "networkidle" });
    await expect(page.locator("#cmpEmptyState")).toBeVisible();

    await page.setInputFiles("#cmpJsonInput", [
        {
            name: "plan-a.sim.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(simulationPayload("Plan A", 0.05))),
        },
        {
            name: "plan-b.sim.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(simulationPayload("Plan B", 0.03, 150_000))),
        },
    ]);

    await expect(page.locator("#cardsSection")).toBeVisible();
    await expect(page.locator(".cmp-card")).toHaveCount(2);
    await expect(page.locator("#verdictSection")).toBeVisible();
    await expect(page.locator(".cmp-card-name")).toContainText(["Plan A", "Plan B"]);

    await page.locator("#cmpClearBtn").click();
    await expect(page.locator("#cmpEmptyState")).toBeVisible();

    await page.setInputFiles("#cmpJsonInput", {
        name: "moj.config.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
            schema: "fire-config/v1",
            name: "Moja konfiguracja",
            config: {},
        })),
    });
    await expect(page.locator("#errorMsg")).toBeVisible();
    await expect(page.locator("#errorMsg")).toContainText("plik konfiguracji");
});
