import { test, expect } from "@playwright/test";

// Jedno źródło prawdy dla tokenów tła (decyzja: karty = --card-bg, insety/kontrole = --bg-elevated).
const CARD_BG = "rgb(30, 33, 48)"; // #1e2130
const ELEVATED = "rgb(34, 37, 58)"; // #22253a

// Niektóre selektory renderują się dopiero ze stanem symulacji — czytamy computed
// style z probe-elementu zastrzykniętego do DOM (stylomania dotyczy klasy globalnej).
const probe = (page, selector) =>
    page.evaluate((sel) => {
        const el = document.createElement("div");
        el.className = sel.replace(/^[.#]/, "");
        document.body.appendChild(el);
        const bg = getComputedStyle(el).backgroundColor;
        el.remove();
        return bg;
    }, selector);

test("karty = --card-bg", async ({ page }) => {
    await page.goto("/wizard", { waitUntil: "networkidle" });
    for (const sel of [".stage-block", ".sim-card", ".config-section", ".summary-card", ".auth-panel", ".landing-card", ".recent-item", ".cmp-card"]) {
        await expect.poll(() => probe(page, sel), { message: sel }).toBe(CARD_BG);
    }
});

test("insety i kontrole = --bg-elevated", async ({ page }) => {
    await page.goto("/wizard", { waitUntil: "networkidle" });
    for (const sel of [".btn-secondary", ".account-toggle", ".col-toggle", ".stage-line", ".icon-btn", ".chart-detail"]) {
        await expect.poll(() => probe(page, sel), { message: sel }).toBe(ELEVATED);
    }
});

test("konfiguracja z treścią /sim", async ({ page }) => {
    await page.goto("/sim?view=config", { waitUntil: "networkidle" });
    await expect.poll(() => probe(page, ".config-section")).toBe(CARD_BG);
    const selectBg = await page.evaluate(() => {
        const wrap = document.createElement("div");
        wrap.className = "config-section";
        const sel = document.createElement("select");
        wrap.appendChild(sel);
        document.body.appendChild(wrap);
        const bg = getComputedStyle(sel).backgroundColor;
        wrap.remove();
        return bg;
    });
    expect(selectBg).toBe(ELEVATED);
});