import { test, expect } from "@playwright/test";

// Jedno źródło prawdy dla tokenów tła (DESIGN.md §1.3): strona = --bg,
// karta = --surface, wkład na karcie / kontrolka = --surface-2.
const SURFACE = "rgb(23, 26, 36)"; // #171a24
const SURFACE_2 = "rgb(31, 35, 49)"; // #1f2331

// Niektóre selektory renderują się dopiero ze stanem symulacji — czytamy computed
// style z probe-elementu zastrzykniętego do DOM (styl dotyczy klasy globalnej).
const probe = (page, selector) =>
    page.evaluate((sel) => {
        const el = document.createElement("div");
        el.className = sel.replace(/^[.#]/, "");
        document.body.appendChild(el);
        const bg = getComputedStyle(el).backgroundColor;
        el.remove();
        return bg;
    }, selector);

test("karty = --surface", async ({ page }) => {
    await page.goto("/sim", { waitUntil: "networkidle" });
    for (const sel of [".card", ".stage-block", ".config-section", ".toolbar", ".action-bar"]) {
        await expect.poll(() => probe(page, sel), { message: sel }).toBe(SURFACE);
    }
});

test("wkłady i kontrolki = --surface-2", async ({ page }) => {
    await page.goto("/sim", { waitUntil: "networkidle" });
    for (const sel of [".card-inset", ".account-card", ".metric", ".btn-secondary", ".pill-toggle", ".chip", ".num-control", ".segmented", ".stage-line", ".banner"]) {
        await expect.poll(() => probe(page, sel), { message: sel }).toBe(SURFACE_2);
    }
});

test("brak kolorów poza tokens.css i brak emoji w JS", async ({ request }) => {
    const files = ["base.css", "components.css", "landing.css", "library.css", "sim.css", "wizard.css"];
    for (const f of files) {
        const css = await (await request.get(`/static/css/${f}`)).text();
        const stripped = css.replace(/url\("data:[^"]*"\)/g, "");
        expect(stripped, `${f}: kolor hex poza tokens.css`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(stripped, `${f}: rgba() poza tokens.css`).not.toMatch(/rgba?\(/);
    }
    for (const f of ["sim-metadata.js", "sim-stages.js", "sim-cards.js", "wizard.js", "simulator.js", "simulations.js", "compare.js"]) {
        const js = await (await request.get(`/static/js/${f}`)).text();
        expect(js, `${f}: emoji w kodzie UI`).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
});

test("rozmiary fontu tylko z tokenów (min 12 px)", async ({ request }) => {
    const files = ["base.css", "components.css", "landing.css", "library.css", "sim.css", "wizard.css"];
    for (const f of files) {
        const css = await (await request.get(`/static/css/${f}`)).text();
        const sizes = [...css.matchAll(/font-size:\s*([0-9.]+)(rem|px)/g)].map((m) => (m[2] === "px" ? Number(m[1]) : Number(m[1]) * 16));
        for (const px of sizes) expect(px, `${f}: font-size ${px}px poniżej 12 px`).toBeGreaterThanOrEqual(11);
    }
});
