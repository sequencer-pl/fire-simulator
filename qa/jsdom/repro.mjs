import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// Repo root — skrypt żyje w qa/jsdom/ i czyta żywe pliki (szablony + JS).
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
function readRel(p) {
    return fs.readFileSync(path.join(ROOT, p), "utf8");
}

// Wyciąga innerHTML bloku `{% block content %}` z żywego szablonu wizard.html.
const tpl = readRel("app/templates/wizard.html");
const startTag = "{% block content %}";
const endTag = "{% endblock %}";
const bodyStart = tpl.indexOf(startTag) + startTag.length;
const bodyEnd = tpl.indexOf(endTag, bodyStart);
const content = tpl.slice(bodyStart, bodyEnd).replace(/\{\{ version \}\}/g, "0");

const html = `<!DOCTYPE html><html><body>${content}</body></html>`;
const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/wizard" });
const { window, document } = dom;

window.scrollTo = () => {};
window.alert = () => {};
window.fetch = (url) => {
    if (String(url).includes("/api/config")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ limits: {} }) });
    }
    if (String(url).includes("/api/wizard/suggest")) {
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ allocations: { broker: 40, lokata: 30 } }),
        });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
};

// Wszystkie skrypty w jednym eval — współdzielą globalną leksykalną przestrzeń
// (top-level `const`/`let`). helpers.js pierwszy, jak w base.html.
const scripts = [
    "static/js/helpers.js",
    "static/js/sim-metadata.js",
    "static/js/sim-utils.js",
    "static/js/controls.js",
    "static/js/wizard.js",
].map(readRel).join("\n;\n");

const harness = `
(async () => {
    const results = [];
    const check = (name, fn) => {
        try {
            results.push({ name, ok: Boolean(fn()), err: null });
        } catch (e) {
            results.push({ name, ok: false, err: String((e && e.message) || e) });
        }
    };
    const assert = (cond) => { if (!cond) throw new Error("assert failed"); };

    function createStageBlock() { return document.createElement("div"); }

    initWizard();
    document.getElementById("wzAge").value = "40";
    document.getElementById("wzGross").value = "8000";
    document.querySelector('input[name="wzSavingsMode"][value="pct"]').checked = true;
    document.getElementById("wzSavings").value = "10";
    setStep(4);

    // ---- Pkt 1: nazwy kroków ----
    check("7 etykiet kroków", () => {
        const labels = [...document.querySelectorAll(".wz-step-label")].map((e) => e.textContent.trim());
        return JSON.stringify(labels) === JSON.stringify([
            "1. Twoje pytanie", "2. Twoje dane", "3. Kapitał",
            "4. Podział oszczędności", "5. Cel i horyzont", "6. Wynik", "7. Podsumowanie",
        ]);
    });
    check("h2 kroku 2 = Twoje dane", () => document.querySelector('.wz-step[data-step="2"] h2').textContent.trim() === "Twoje dane");
    check("h2 kroku 5 = Cel i horyzont", () => document.querySelector('.wz-step[data-step="5"] h2').textContent.trim() === "Cel i horyzont");

    // ---- Pkt 2: krok 2 — struktura ----
    check("krok 2: 4 field-group + savings-row (full-width)", () => {
        const fields = document.querySelector('.wz-step[data-step="2"] .wz-fields');
        return fields.querySelectorAll(":scope > .field-group").length === 4 && !!fields.querySelector(".wz-savings-row");
    });

    // ---- Pkt 4/5: struktura kroku 4 ----
    check("krok 4: 4 panele w kolejności", () => {
        const panels = [...document.querySelector('.wz-step[data-step="4"]').querySelectorAll(".wz-alloc-panel")];
        if (panels.length !== 4) return false;
        const titles = panels.map((p) => p.querySelector(".wz-panel-title")?.textContent.trim());
        return JSON.stringify(titles) === JSON.stringify(["Strategia", "Podział", "Dodaj instrument", "Wpłaty z pensji"]);
    });
    check("wiersz Gotówka disabled, nad siatką, z kwotą", () => {
        const row = document.getElementById("wzAllocCashRow");
        const range = row?.querySelector("input[type=range]");
        const grid = document.getElementById("wzAllocGrid");
        const pos = row && grid ? row.compareDocumentPosition(grid) : 0;
        return !!range && range.disabled === true && (pos & 4) !== 0 && !!document.getElementById("wzAllocCashMoney");
    });
    check("payroll panel ukryty gdy brak PPK/PPE", () => document.getElementById("wzPayrollPanel").classList.contains("hidden"));
    check("pills panel widoczny gdy brak aktywnych kont", () => !document.getElementById("wzAllocPillsPanel").classList.contains("hidden"));

    // ---- Gotówka jako bufor: 100% na starcie ----
    check("cash row: 100% i pełna pula gdy nic rozdysponowane", () => {
        const r = document.querySelector("#wzAllocCashRow input[type=range]");
        return r.value === "100" && document.getElementById("wzAllocCashMoney").textContent === "800 zł/mies.";
    });

    // ---- pastylka dodaje wiersz; suwak kurczy gotówkę ----
    check("pastylka Broker -> 1 wiersz, cash 75% / 600 zł", () => {
        wzPill.add("broker"); buildAllocationStep(); setWzWeight("broker", 25);
        const rows = document.querySelectorAll("#wzAllocGrid .wz-alloc-row").length;
        const r = document.querySelector("#wzAllocCashRow input[type=range]");
        return rows === 1 && r.value === "75" && document.getElementById("wzAllocCashMoney").textContent === "600 zł/mies.";
    });
    check("num-control alokacji zachowuje data-account i step", () => {
        const input = document.querySelector('#wzAllocGrid .acc-field.wz-alloc-pct[data-account="broker"]');
        return !!input && input.step === "1" && !!input.getAttribute("aria-label").startsWith("Udział Broker");
    });
    check("zostało 10 pastylek (8 alokowalnych + PPK/PPE), panel wciąż widoczny", () => {
        return document.querySelectorAll("#wzAllocPills .wz-pill").length === 10
            && !document.getElementById("wzAllocPillsPanel").classList.contains("hidden");
    });
    check("100% -> Gotówka 0 zł/mies. i 0%", () => {
        setWzWeight("broker", 100);
        const r = document.querySelector("#wzAllocCashRow input[type=range]");
        return r.value === "0" && document.getElementById("wzAllocCashMoney").textContent === "0 zł/mies.";
    });

    // ---- PPK pastylka -> belka payroll ----
    check("PPK pastylka -> belka Wpłat z pensji", () => {
        wzPill.add("ppk"); buildAllocationStep();
        return !document.getElementById("wzPayrollPanel").classList.contains("hidden")
            && document.querySelectorAll("#wzPayrollActive .wz-alloc-row").length === 1;
    });

    // ---- suggest ----
    check("Zaproponuj podział: 2 wiersze, bez gotówki w wagach", async () => {
        await runSuggestAllocation();
        return document.querySelectorAll("#wzAllocGrid .wz-alloc-row").length === 2
            && !Object.keys(wzWeights).includes("gotowka");
    });

    // ---- Pkt 6: krok 5 ----
    setStep(5);
    check("krok 5: 4 pola, każde z .num-control i .wz-hint", () => {
        const groups = [...document.querySelector('.wz-step[data-step="5"] .wz-fields').querySelectorAll(".field-group")];
        return groups.length === 4 && groups.every((g) => g.querySelector(".num-control .acc-field") && g.querySelector(".wz-hint"));
    });
    check("wiek emerytury: puste -> stepper od data-empty=65", () => {
        const input = document.getElementById("wzRetirement");
        input.value = "";
        input.closest(".num-control").querySelector(".stepper-up").dispatchEvent(new Event("click", { bubbles: true }));
        return input.value === "66";
    });

    const failed = results.filter((r) => !r.ok);
    const NL = String.fromCharCode(10);
    console.log(NL + "=== FIRE wizard.js — harness jsdom ===");
    for (const r of results) {
        console.log((r.ok ? "PASS" : "FAIL") + "  " + r.name + (r.err ? "  (" + r.err + ")" : ""));
    }
    console.log(NL + (failed.length === 0 ? "ALL CHECKS PASSED" : "FAILURES: " + failed.length));
    if (failed.length) window.__fireFailed = failed.length;
})();
`;

// Uruchom skrypty, a potem harness (async), w jednej globalnej przestrzeni.
window.eval(scripts + "\n;\n" + harness);

setTimeout(() => {
    if (window.__fireFailed) process.exit(1);
    process.exit(0);
}, 500);