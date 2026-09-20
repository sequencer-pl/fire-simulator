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

    // ---- Pkt 1: pasek postępu (podziałki bez etykiet nazw) ----
    check("pasek postępu: track + progressbar, bez etykiet nazw", () => {
        const track = document.getElementById("wizardProgressTrack");
        const bar = document.getElementById("wizardProgressBar");
        return !!track
            && !!bar
            && bar.getAttribute("role") === "progressbar"
            && bar.getAttribute("aria-valuemin") === "1"
            && bar.getAttribute("aria-valuemax") === "7"
            && document.querySelectorAll(".wz-step-label").length === 0;
    });
    check("pasek postępu: aria-valuenow = bieżący krok", () => {
        setStep(4);
        return document.getElementById("wizardProgressBar").getAttribute("aria-valuenow") === "4";
    });
    check("h2 kroku 2 = Twoje dane", () => document.querySelector('.wz-step[data-step="2"] h2').textContent.trim() === "Twoje dane");
    check("h2 kroku 5 = Cel i horyzont", () => document.querySelector('.wz-step[data-step="5"] h2').textContent.trim() === "Cel i horyzont");

    // ---- Pkt 2: krok 2 — 3 panele, suwak oszczędności tylko w trybie % ----
    check("krok 2: 3 panele w kolejności", () => {
        const panels = [...document.querySelector('.wz-step[data-step="2"]').querySelectorAll(".wz-panel")];
        if (panels.length !== 3) return false;
        const titles = panels.map((p) => p.querySelector(".wz-panel-title")?.textContent.trim());
        return JSON.stringify(titles) === JSON.stringify(["Ty", "Praca i dochód", "Odkładasz miesięcznie"]);
    });
    check("krok 2: płeć = Kobieta / Mężczyzna", () => {
        const labels = [...document.querySelectorAll('input[name="wzGender"]')].map((i) => i.parentElement.textContent.trim());
        return JSON.stringify(labels) === JSON.stringify(["Kobieta", "Mężczyzna"]);
    });
    check("krok 2: suwaki oszczędności — tryb % (0-50) i kwota (pensja/2)", () => {
        const pctRange = document.getElementById("wzSavingsRange");
        const amtRange = document.getElementById("wzSavingsAmtRange");
        document.querySelector('input[name="wzSavingsMode"][value="pct"]').checked = true;
        document.querySelector('input[name="wzSavingsMode"][value="pct"]').dispatchEvent(new Event("change"));
        const pctOk = !!pctRange && !pctRange.classList.contains("hidden")
            && document.getElementById("wzSavings").max === "50"
            && amtRange.classList.contains("hidden");
        document.querySelector('input[name="wzSavingsMode"][value="amount"]').checked = true;
        document.querySelector('input[name="wzSavingsMode"][value="amount"]').dispatchEvent(new Event("change"));
        const amtOk = pctRange.classList.contains("hidden")
            && !!amtRange && !amtRange.classList.contains("hidden")
            && amtRange.max === "4000"
            && !document.getElementById("wzSavings").hasAttribute("max");
        document.querySelector('input[name="wzSavingsMode"][value="pct"]').checked = true;
        document.querySelector('input[name="wzSavingsMode"][value="pct"]').dispatchEvent(new Event("change"));
        document.getElementById("wzSavings").value = "10";
        document.getElementById("wzSavingsRange").value = "10";
        return pctOk === true && amtOk === true;
    });
    check("krok 2: suwak wieku bind (16-90)", () => {
        const range = document.getElementById("wzAgeRange");
        const input = document.getElementById("wzAge");
        if (!range || !input) return false;
        range.value = "60";
        range.dispatchEvent(new Event("input", { bubbles: true }));
        const a = input.value;
        input.value = "25";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const b = range.value;
        input.value = "40";
        return range.min === "16" && range.max === "90" && a === "60" && b === "25";
    });
    check("krok 2: pensja suwak max 50000 + bind", () => {
        const range = document.getElementById("wzGrossRange");
        const input = document.getElementById("wzGross");
        if (!range || !input) return false;
        range.value = "46000";
        range.dispatchEvent(new Event("input", { bubbles: true }));
        const a = input.value;
        input.value = "32000";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const b = range.value;
        input.value = "8000";
        return range.max === "50000" && a === "46000" && b === "32000";
    });
    check("krok 2: warning przy kwocie > pensji brutto", () => {
        const warn = document.getElementById("wzSavingsWarn");
        document.querySelector('input[name="wzSavingsMode"][value="amount"]').checked = true;
        document.querySelector('input[name="wzSavingsMode"][value="amount"]').dispatchEvent(new Event("change"));
        document.getElementById("wzSavings").value = "9500";
        document.getElementById("wzSavings").dispatchEvent(new Event("input", { bubbles: true }));
        const shown = !warn.hidden && warn.textContent.includes("więcej");
        document.getElementById("wzSavings").value = "3000";
        document.getElementById("wzSavings").dispatchEvent(new Event("input", { bubbles: true }));
        const hidden = warn.hidden;
        document.querySelector('input[name="wzSavingsMode"][value="pct"]').checked = true;
        document.querySelector('input[name="wzSavingsMode"][value="pct"]').dispatchEvent(new Event("change"));
        document.getElementById("wzSavings").value = "10";
        return shown === true && hidden === true;
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

    // ---- Pasek nawigacji wz-footer ----
    check("footer: pasek z licznikiem i przyciskami", () => {
        return !!document.getElementById("wzFooter")
            && !!document.getElementById("wzStepCount")
            && !!document.getElementById("wzBackBtn")
            && !!document.getElementById("wzNextBtn");
    });
    check("footer: krok 1 -> licznik 'Krok 1 / 7' i Wstecz ukryty", () => {
        setStep(1);
        return document.getElementById("wzStepCount").textContent.trim() === "Krok 1 / 7"
            && document.getElementById("wzBackBtn").classList.contains("hidden");
    });
    check("footer: krok 4 -> licznik 'Krok 4 / 7' i Wstecz widoczny", () => {
        setStep(4);
        return document.getElementById("wzStepCount").textContent.trim() === "Krok 4 / 7"
            && !document.getElementById("wzBackBtn").classList.contains("hidden");
    });
    check("footer: krok 6 -> etykieta 'Wylicz plan'", () => {
        setStep(6);
        return document.getElementById("wzNextBtn").textContent.trim() === "Wylicz plan";
    });
    check("footer: błąd planu -> etykieta wraca do 'Wylicz plan'", async () => {
        await runPlan();
        return document.getElementById("wzNextBtn").textContent.trim() === "Wylicz plan"
            && wzPlan === null;
    });
    check("footer: krok 7 -> 'Przejdź do symulatora'", () => {
        setStep(7);
        return document.getElementById("wzNextBtn").textContent.trim() === "Przejdź do symulatora";
    });
    check("footer: krok 5 -> 'Dalej'", () => {
        setStep(5);
        return document.getElementById("wzNextBtn").textContent.trim() === "Dalej";
    });

    // ---- Notatka o wypłatach netto w bloku wyniku (krok 6) ----
    check("notatka o wypłatach netto w bloku wyniku, brak footnote pod kartą", () => {
        setStep(6);
        const note = document.querySelector('.wz-step[data-step="6"] .wz-result-note');
        return !!note
            && note.textContent.includes("Wypłaty pokazane są netto")
            && document.querySelector(".wizard-footnote") === null;
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