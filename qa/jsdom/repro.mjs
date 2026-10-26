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
            json: () => Promise.resolve({ allocations: { broker: 40, lokata: 30 }, pool_monthly: 800 }),
        });
    }
    if (String(url).includes("/api/wizard/salary")) {
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ gross_monthly: 8000, net_monthly: 5789.53 }),
        });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
};

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
    const zl = (n) => Math.round(n).toLocaleString("pl-PL");

    function createStageBlock() { return document.createElement("div"); }

    initWizard();
    document.getElementById("wzAge").value = "40";
    document.getElementById("wzGross").value = "8000";
    document.getElementById("wzSavings").value = "1000";
    setStep(5);

    // ---- Pkt 1: pasek postępu (podziałki bez etykiet nazw, 6 kroków) ----
    check("pasek postępu: track + progressbar (6 kroków), bez etykiet nazw", () => {
        const track = document.getElementById("wizardProgressTrack");
        const bar = document.getElementById("wizardProgressBar");
        return !!track
            && !!bar
            && bar.getAttribute("role") === "progressbar"
            && bar.getAttribute("aria-valuemin") === "1"
            && bar.getAttribute("aria-valuemax") === "6"
            && document.querySelectorAll(".wz-step-label").length === 0;
    });
    check("pasek postępu: aria-valuenow = bieżący krok", () => {
        setStep(5);
        return document.getElementById("wizardProgressBar").getAttribute("aria-valuenow") === "5";
    });
    check("h2 kroku 2 = Twoje dane", () => document.querySelector('.wz-step[data-step="2"] h2').textContent.trim() === "Twoje dane");
    check("h2 kroku 4 dopasowane do ścieżki 1", () => document.querySelector('.wz-step[data-step="4"] h2').textContent.trim() === "Kiedy chcesz przejść na FIRE?");
    check("h2 kroku 5 = Strategia i założenia", () => document.querySelector('.wz-step[data-step="5"] h2').textContent.trim() === "Strategia i założenia");
    check("h2 kroku 6 = Twój plan FIRE", () => document.querySelector('.wz-step[data-step="6"] h2').textContent.trim() === "Twój plan FIRE");
    check("krok 3: wszystkie 14 kont jako pastylki + dodawanie/usuwanie pola kwotowego", () => {
        const pills = document.querySelectorAll("#wzCapitalPicker .wz-pill");
        const initRows = document.querySelectorAll("#wzCapitalGrid .wz-capital-item").length;
        document.querySelector('#wzCapitalPicker .wz-pill[data-account="ike"]').click();
        const afterAdd = document.querySelectorAll("#wzCapitalGrid .wz-capital-item").length;
        document.querySelector('#wzCapitalGrid .wz-capital-item[data-account="ike"] .wz-pill-remove').click();
        const afterRm = document.querySelectorAll("#wzCapitalGrid .wz-capital-item").length;
        return pills.length === 14 && initRows === 0 && afterAdd === 1 && afterRm === 0;
    });

    // ---- Pkt 2: krok 2 — 3 panele, suwak oszczędności 0-100% i kwota do 100% pensji ----
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
    check("krok 2: oszczędności tylko kwotowo — domyślnie 1000 zł, bez trybu %", () => {
        const input = document.getElementById("wzSavings");
        const amtRange = document.getElementById("wzSavingsAmtRange");
        return !!input && input.value === "1000" && input.step === "50"
            && !input.hasAttribute("max")
            && !!amtRange && amtRange.value === "1000"
            && document.getElementById("wzSavingsRange") === null
            && document.querySelectorAll('input[name="wzSavingsMode"]').length === 0;
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
    check("krok 2: pensja suwak max 100000 + bind", () => {
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
        return range.max === "100000" && a === "46000" && b === "32000";
    });
    check("krok 2: przełącznik Brutto/Netto tylko dla etatu", () => {
        const mode = document.getElementById("wzSalaryMode");
        const label = document.getElementById("wzGrossLabel");
        const etat = document.querySelector('input[name="wzEmployment"][value="etat"]');
        const row = mode.closest(".wz-choice-row");
        const layoutOk = !!row
            && row.querySelector('input[name="wzEmployment"]') !== null
            && mode.closest("#wzGrossGroup") === null
            && document.getElementById("wzSalaryHint").closest(".wz-field-head") !== null;
        etat.checked = true;
        etat.dispatchEvent(new Event("change"));
        const visibleEtat = !mode.classList.contains("hidden");
        const grossLabel = label.textContent;
        const netRadio = document.querySelector('input[name="wzSalaryMode"][value="net"]');
        netRadio.checked = true;
        netRadio.dispatchEvent(new Event("change"));
        const netLabel = label.textContent;
        const b2b = document.querySelector('input[name="wzEmployment"][value="b2b"]');
        b2b.checked = true;
        b2b.dispatchEvent(new Event("change"));
        const hiddenB2b = mode.classList.contains("hidden")
            && document.getElementById("wzSalaryHint").textContent.includes("netto zależy");
        etat.checked = true;
        etat.dispatchEvent(new Event("change"));
        return layoutOk
            && visibleEtat
            && grossLabel === "Pensja brutto (mies.)"
            && netLabel === "Pensja netto (mies.)"
            && hiddenB2b;
    });
    check("krok 2: warning gdy kwota > pensja netto, hint % netto", () => {
        const input = document.getElementById("wzSavings");
        const warn = document.getElementById("wzSavingsWarn");
        const hint = document.getElementById("wzSavingsHint");
        const etat = document.querySelector('input[name="wzEmployment"][value="etat"]');
        etat.checked = true;
        etat.dispatchEvent(new Event("change"));
        wzNetMonthly = 5790;
        updateSavingsAmtMax();
        input.value = "6000";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const shown = !warn.hidden && warn.textContent.includes("pensja netto");
        const sliderMax = document.getElementById("wzSavingsAmtRange").max;
        input.value = "1000";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const hidden = warn.hidden;
        const hintOk = hint.textContent.includes("17,3% pensji netto");
        return shown && hidden && sliderMax === "5750" && hintOk;
    });
    check("krok 2: brak pensji netto — suwak ma zapas 10000", () => {
        wzNetMonthly = null;
        updateSavingsAmtMax();
        return document.getElementById("wzSavingsAmtRange").max === "10000";
    });

    // ---- Pkt 4/5: struktura kroku 5 (Strategia i założenia) ----
    check("krok 5: 5 paneli w kolejności (Założenia, Strategia, Podział, Dodaj, Wpłaty)", () => {
        const panels = [...document.querySelector('.wz-step[data-step="5"]').querySelectorAll(".wz-alloc-panel")];
        if (panels.length !== 5) return false;
        const titles = panels.map((p) => p.querySelector(".wz-panel-title")?.textContent.trim());
        return JSON.stringify(titles) === JSON.stringify([
            "Założenia rynkowe (koniunktura)",
            "Strategia podziału oszczędności",
            "Podział",
            "Dodaj instrument",
            "Wpłaty z pensji",
        ]);
    });
    check("wiersz Gotówka disabled, nad siatką, z kwotą", () => {
        const row = document.getElementById("wzAllocCashRow");
        const range = row?.querySelector("input[type=range]");
        const grid = document.getElementById("wzAllocGrid");
        const pos = row && grid ? row.compareDocumentPosition(grid) : 0;
        return !!range && range.disabled === true && (pos & 4) !== 0 && !!document.getElementById("wzAllocCashMoney");
    });
    check("krok 5: na starcie przed wyborem strategii panele Podział/Dodaj/Wpłaty są ukryte", () => {
        return wzAllocMode === null
            && ["wzAllocPanel", "wzAllocPillsPanel", "wzPayrollPanel"].every(
                (id) => document.getElementById(id).classList.contains("hidden"),
            );
    });
    check("krok 5: wybór strategii „Manualna” odsłania Podział i Dodaj instrument", () => {
        wzPill.clear();
        Object.keys(wzWeights).forEach((k) => delete wzWeights[k]);
        const manualRadio = document.querySelector('input[name="wzStrategy"][value="manualna"]');
        manualRadio.checked = true;
        manualRadio.dispatchEvent(new Event("change"));
        return wzAllocMode === "manual"
            && !document.getElementById("wzAllocPanel").classList.contains("hidden")
            && !document.getElementById("wzAllocPillsPanel").classList.contains("hidden");
    });
    check("payroll panel ukryty gdy brak PPK/PPE", () => document.getElementById("wzPayrollPanel").classList.contains("hidden"));
    check("strategia: 4 opcje (Konserwatywna, Zrównoważona, Agresywna, Manualna) + 3 opcje założeń", () => {
        const stratBox = document.querySelector(".wz-alloc-strategy-options");
        const assumpBox = document.querySelector(".wz-assumptions-options");
        return !!stratBox
            && !!assumpBox
            && stratBox.querySelectorAll(".gender-option").length === 4
            && assumpBox.querySelectorAll(".gender-option").length === 3;
    });

    // ---- Gotówka jako bufor: pełna pula roczna/miesięczna na starcie ----
    check("cash row: 100% i pełna pula roczna/miesięczna gdy nic rozdysponowane", () => {
        const r = document.querySelector("#wzAllocCashRow input[type=range]");
        return r.value === "100"
            && document.getElementById("wzAllocCashAnnual").textContent === zl(12000) + " zł/rok"
            && document.getElementById("wzAllocCashMoney").textContent === "≈" + zl(1000) + " zł/mies."
            && document.getElementById("wzAllocCashPct").textContent === "≈100%";
    });

    // ---- pastylka dodaje wiersz; kwota roczna kurczy gotówkę ----
    check("pastylka Broker -> 1 wiersz; 3 000 zł/rok = 25%, cash 9 000 zł/rok", () => {
        wzPill.add("broker"); buildAllocationStep(); setWzAmount("broker", 3000);
        const rows = document.querySelectorAll("#wzAllocGrid .wz-alloc-row").length;
        const r = document.querySelector("#wzAllocCashRow input[type=range]");
        const input = document.querySelector('#wzAllocGrid .wz-alloc-annual-input[data-account="broker"]');
        const pct = document.querySelector('#wzAllocGrid .wz-alloc-pct[data-account="broker"]');
        return rows === 1 && r.value === "75" && input.value === "3000"
            && pct.textContent === "≈25%"
            && document.getElementById("wzAllocCashAnnual").textContent === zl(9000) + " zł/rok"
            && document.getElementById("wzAllocCashMoney").textContent === "≈" + zl(750) + " zł/mies.";
    });
    check("kwota blokuje przydział powyżej pozostałej puli (cap at remaining)", () => {
        wzPill.add("lokata"); buildAllocationStep();
        setWzAmount("broker", 8400);
        setWzAmount("lokata", 99999); // powinno zatrzymać się na pozostałych 3 600 zł
        return Math.round(wzAmounts["broker"]) === 8400 && Math.round(wzAmounts["lokata"]) === 3600
            && document.getElementById("wzAllocCashAnnual").textContent === "0 zł/rok";
    });
    check("pole roczne alokacji: data-account, step 10, aria-label", () => {
        const input = document.querySelector('#wzAllocGrid .wz-alloc-annual-input[data-account="broker"]');
        return !!input && input.step === "10"
            && input.getAttribute("aria-label") === "Wpłata roczna Broker";
    });
    check("zostało 9 pastylek (7 alokowalnych + PPK/PPE), panel wciąż widoczny", () => {
        return document.querySelectorAll("#wzAllocPills .wz-pill").length === 9
            && !document.getElementById("wzAllocPillsPanel").classList.contains("hidden");
    });
    check("100% -> Gotówka 0 zł/rok, 0 zł/mies. i 0%", () => {
        setWzAmount("lokata", 0);
        setWzAmount("broker", 12000);
        const r = document.querySelector("#wzAllocCashRow input[type=range]");
        return r.value === "0"
            && document.getElementById("wzAllocCashAnnual").textContent === "0 zł/rok"
            && document.getElementById("wzAllocCashMoney").textContent === "≈0 zł/mies."
            && document.getElementById("wzAllocCashPct").textContent === "0%";
    });

    // ---- roczne limity kont (IKE/IKZE/OIPE) blokują suwak i pole ----
    check("IKE: kwota nie przekracza limitu rocznego 28 260 zł", () => {
        wzLimits = { ike_annual: 28260, ikze_annual: 11304, ikze_annual_self_employed: 16956, oipe_annual: 28260 };
        document.getElementById("wzSavings").value = "3000"; // 36 000 zł/rok
        wzPill.clear();
        Object.keys(wzWeights).forEach((k) => delete wzWeights[k]);
        Object.keys(wzAmounts).forEach((k) => delete wzAmounts[k]);
        wzPill.add("ike"); buildAllocationStep();
        setWzAmount("ike", 99999);
        const cap = document.querySelector('.wz-alloc-cap[data-account="ike"]');
        const input = document.querySelector('#wzAllocGrid .wz-alloc-annual-input[data-account="ike"]');
        return Math.round(wzAmounts["ike"]) === 28260
            && input.max === "28260"
            && cap.textContent.includes("limit roczny osiągnięty")
            && document.getElementById("wzAllocCashAnnual").textContent === zl(7740) + " zł/rok";
    });

    // ---- nadwyżka nad limitem: tylko materialna (>= 1 zł/mies.) ----
    check("mikronadwyżka (<1 zł/mies.) nie pokazuje komunikatu", () => {
        document.querySelector('input[name="wzPath"][value="2"]').checked = true;
        wzAllocMode = "auto";
        wzEstimatedPoolMonthly = 28260.8 / 12;
        wzWeights = { ike: 100 };
        wzAmounts = {};
        buildAllocationStep();
        const ov = document.querySelector('.wz-alloc-overflow[data-account="ike"]');
        return !!ov && ov.classList.contains("hidden") && ov.textContent === "";
    });
    check("realna nadwyżka (>= 1 zł/mies.) pokazuje komunikat i kwotę", () => {
        wzEstimatedPoolMonthly = 40000 / 12;
        buildAllocationStep();
        const ov = document.querySelector('.wz-alloc-overflow[data-account="ike"]');
        return !!ov && !ov.classList.contains("hidden")
            && ov.textContent.includes("nadwyżka") && ov.textContent.includes("zł/mies.")
            && !ov.textContent.includes("0 zł/mies.");
    });

    // ---- ścieżka 2: procenty są kanoniczne, kwoty przeliczają się z pulą ----
    check("ścieżka 2: edycja kwoty ustawia wagę, zmiana puli skaluje kwotę", () => {
        wzAllocMode = "manual";
        wzPill.clear();
        Object.keys(wzWeights).forEach((k) => delete wzWeights[k]);
        Object.keys(wzAmounts).forEach((k) => delete wzAmounts[k]);
        wzPill.add("broker");
        wzEstimatedPoolMonthly = 1000; // 12 000 zł/rok
        buildAllocationStep();
        setWzAmount("broker", 3000);
        const weight = wzWeights["broker"];
        wzEstimatedPoolMonthly = 2000; // 24 000 zł/rok
        buildAllocationStep();
        const input = document.querySelector('#wzAllocGrid .wz-alloc-annual-input[data-account="broker"]');
        const pct = document.querySelector('#wzAllocGrid .wz-alloc-pct[data-account="broker"]');
        return Math.abs(weight - 25) < 1e-6 && input.value === "6000" && pct.textContent === "≈25%"
            && document.getElementById("wzAllocCashAnnual").textContent === zl(18000) + " zł/rok";
    });

    // ---- ścieżka 1: kwoty stałe; wzrost puli -> Gotówka, spadek -> proporcjonalne cięcie ----
    check("ścieżka 1: wzrost puli zostawia kwoty, nadwyżka -> Gotówka", () => {
        document.querySelector('input[name="wzPath"][value="1"]').checked = true;
        wzEstimatedPoolMonthly = null;
        wzPill.clear();
        Object.keys(wzWeights).forEach((k) => delete wzWeights[k]);
        Object.keys(wzAmounts).forEach((k) => delete wzAmounts[k]);
        wzPill.add("broker");
        document.getElementById("wzSavings").value = "1000";
        buildAllocationStep();
        setWzAmount("broker", 6000);
        document.getElementById("wzSavings").value = "2000";
        refreshAllocationDisplay();
        return Math.round(wzAmounts["broker"]) === 6000
            && document.getElementById("wzAllocCashAnnual").textContent === zl(18000) + " zł/rok"
            && document.getElementById("wzAllocCashMoney").textContent === "≈" + zl(1500) + " zł/mies.";
    });
    check("ścieżka 1: spadek puli przycina kwoty proporcjonalnie", () => {
        wzPill.add("lokata"); buildAllocationStep();
        setWzAmount("broker", 6000);
        setWzAmount("lokata", 6000);
        document.getElementById("wzSavings").value = "500"; // 6 000 zł/rok
        refreshAllocationDisplay();
        return Math.round(wzAmounts["broker"]) === 3000
            && Math.round(wzAmounts["lokata"]) === 3000
            && document.getElementById("wzAllocCashAnnual").textContent === "0 zł/rok";
    });
    check("ścieżka 1: kwoty i wagi wracają do stanu wyjściowego", () => {
        document.getElementById("wzSavings").value = "1000";
        refreshAllocationDisplay();
        return Math.round(wzAmounts["broker"]) === 3000 && Math.round(wzAmounts["lokata"]) === 3000;
    });

    // ---- PPK pastylka -> belka payroll ----
    check("PPK pastylka -> belka Wpłat z pensji", () => {
        wzPill.add("ppk"); buildAllocationStep();
        return !document.getElementById("wzPayrollPanel").classList.contains("hidden")
            && document.querySelectorAll("#wzPayrollActive .wz-alloc-row").length === 1;
    });

    // ---- suggest ----
    check("Zaproponuj: 2 wiersze, kwoty z wag, bez gotówki w wagach", async () => {
        await runSuggestAllocation();
        const broker = document.querySelector('#wzAllocGrid .wz-alloc-annual-input[data-account="broker"]');
        return document.querySelectorAll("#wzAllocGrid .wz-alloc-row").length === 2
            && !Object.keys(wzWeights).includes("gotowka")
            && broker && broker.value === "4800";
    });

    // ---- bug: usuwanie instrumentu czyści kwotę/wagę (martwe udziały nie wracają) ----
    check("Usuń wiersz czyści kwotę — gotówka rośnie o usunięty udział", () => {
        setAllocMode("manual");
        wzPill.clear();
        Object.keys(wzWeights).forEach((k) => delete wzWeights[k]);
        Object.keys(wzAmounts).forEach((k) => delete wzAmounts[k]);
        ["broker", "lokata", "ike"].forEach((a) => wzPill.add(a));
        buildAllocationStep();
        setWzAmount("broker", 3000); setWzAmount("lokata", 6000); setWzAmount("ike", 3000);
        document.querySelector('.wz-alloc-grid .wz-pill-remove[aria-label="Usuń Lokata"]').click();
        const cashMid = document.getElementById("wzAllocCashAnnual").textContent;
        document.querySelector('.wz-alloc-grid .wz-pill-remove[aria-label="Usuń Broker"]').click();
        document.querySelector('.wz-alloc-grid .wz-pill-remove[aria-label="Usuń IKE"]').click();
        const cash = document.getElementById("wzAllocCashAnnual").textContent;
        const total = Object.values(collectAllocations()).reduce((a, b) => a + (b || 0), 0);
        return cashMid === zl(6000) + " zł/rok" && cash === zl(12000) + " zł/rok" && total === 0 && wzPill.size === 0;
    });

    // ---- gate kroku 5: wymóg wyboru strategii ----
    check("krok 5: bez strategii „Wylicz plan” zablokowane + tooltip; klik pokazuje dymek; wybór odblokowuje", () => {
        wzAllocMode = null;
        setStep(5);
        const next = document.getElementById("wzNextBtn");
        const tip = document.getElementById("wzNextTip");
        const pop = document.getElementById("wzNextPop");
        const blocked = next.disabled === true && tip && tip.title.trim().length > 0
            && tip.classList.contains("is-locked");
        tip.dispatchEvent(new Event("click", { bubbles: true }));
        const popShown = pop && !pop.hidden && pop.textContent === tip.title;
        setAllocMode("manual");
        return blocked && popShown && next.disabled === false && tip.title === ""
            && pop.hidden === true && !tip.classList.contains("is-locked");
    });
    check("gate: powrót na krok 1 odblokowuje „Dalej” (stan nie przykleja się)", () => {
        setStep(1);
        return document.getElementById("wzNextBtn").disabled === false;
    });
    check("gate: klik „Dalej” z kroku 4 nie pokazuje dymka (bubbling po setStep)", () => {
        wzAllocMode = null;
        setStep(4);
        const pop = document.getElementById("wzNextPop");
        document.getElementById("wzNextBtn").click();
        return wzNavStep === 5
            && document.getElementById("wzNextBtn").disabled === true
            && pop && pop.hidden === true;
    });
    check("gate: nagłówek podziału (pula oszczędności) widoczny od wejścia na krok 5 — przed wyborem strategii", () => {
        wzAllocMode = null;
        setStep(5);
        const header = document.getElementById("wzAllocHeader");
        const note = document.getElementById("wzAllocCashNote");
        const panel = document.getElementById("wzAllocPanel");
        return wzNavStep === 5
            && header && header.textContent.trim().length > 0
            && header.textContent.trim().includes("zł/mies")
            && note && note.hidden === false
            && panel && panel.classList.contains("hidden");
    });
    check("strategie: 4 opcje z emoji (🛡️, ⚖️, 🚀, 🎛️)", () => {
        const labelsOnes = document.querySelectorAll('.wz-alloc-strategy-options .gender-option');
        return labelsOnes.length === 4
            && [...labelsOnes].some((l) => l.textContent.includes("🛡️"))
            && [...labelsOnes].some((l) => l.textContent.includes("⚖️") && l.textContent.includes("Zrównoważona"))
            && [...labelsOnes].some((l) => l.textContent.includes("🚀"))
            && [...labelsOnes].some((l) => l.textContent.includes("🎛️") && l.textContent.includes("Manualna"));
    });

    // ---- Pkt 6: krok 4 (Cel i horyzont) ----
    setStep(4);
    check("krok 4: 4 pola w pełnych wierszach (.wz-slider), bez .wz-hint", () => {
        const step = document.querySelector('.wz-step[data-step="4"]');
        const rows = [...step.querySelector(".wz-rows").children];
        return rows.length === 4
            && rows.every((r) => r.querySelector(".wz-slider .num-control .acc-field")
                && r.querySelector('.wz-slider input[type="range"]'))
            && step.querySelectorAll(".wz-hint").length === 0;
    });
    check("krok 4: domyślne wg płci (m): emerytura 65, horyzont = wiek + dalsze trwanie życia", () => {
        const age = document.getElementById("wzAge");
        age.value = "40";
        age.dispatchEvent(new Event("input", { bubbles: true }));
        const retirement = document.getElementById("wzRetirement");
        const planEnd = document.getElementById("wzPlanEnd");
        return retirement.value === "65"
            && document.getElementById("wzRetirementRange").value === "65"
            && planEnd.value === String(planEndDefault("m", 40))
            && document.getElementById("wzPlanEndRange").value === planEnd.value;
    });
    check("krok 4: zmiana płci (nietknięte) -> emerytura 60, horyzont wg kobiet", () => {
        document.querySelector('input[name="wzGender"][value="k"]').click();
        return document.getElementById("wzRetirement").value === "60"
            && document.getElementById("wzPlanEnd").value === String(planEndDefault("k", 40));
    });
    check("krok 4: zmiana wieku (nietknięty horyzont) przelicza horyzont", () => {
        const age = document.getElementById("wzAge");
        age.value = "50";
        age.dispatchEvent(new Event("input", { bubbles: true }));
        return document.getElementById("wzPlanEnd").value === String(planEndDefault("k", 50));
    });
    check("krok 4: ręczna edycja nie jest nadpisywana (płeć i wiek)", () => {
        const planEnd = document.getElementById("wzPlanEnd");
        planEnd.value = "100";
        planEnd.dispatchEvent(new Event("input", { bubbles: true }));
        document.getElementById("wzAge").dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector('input[name="wzGender"][value="m"]').click();
        return planEnd.value === "100"
            && document.getElementById("wzRetirement").value === "65";
    });
    check("krok 4: ręcznie ustawiona emerytura też nie jest nadpisywana zmianą płci", () => {
        document.querySelector('input[name="wzGender"][value="k"]').click();
        const retirement = document.getElementById("wzRetirement");
        retirement.value = "67";
        retirement.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector('input[name="wzGender"][value="m"]').click();
        return retirement.value === "67";
    });

    // ---- Pasek nawigacji wz-footer ----
    check("footer: pasek z licznikiem i przyciskami", () => {
        return !!document.getElementById("wzFooter")
            && !!document.getElementById("wzStepCount")
            && !!document.getElementById("wzBackBtn")
            && !!document.getElementById("wzNextBtn");
    });
    check("footer: krok 1 -> licznik 'Krok 1 / 6' i Wstecz ukryty", () => {
        setStep(1);
        return document.getElementById("wzStepCount").textContent.trim() === "Krok 1 / 6"
            && document.getElementById("wzBackBtn").classList.contains("hidden");
    });
    check("footer: krok 4 -> licznik 'Krok 4 / 6', Wstecz widoczny, etykieta 'Dalej'", () => {
        setStep(4);
        return document.getElementById("wzStepCount").textContent.trim() === "Krok 4 / 6"
            && !document.getElementById("wzBackBtn").classList.contains("hidden")
            && document.getElementById("wzNextBtn").textContent.trim() === "Dalej";
    });
    check("footer: krok 5 -> etykieta 'Wylicz plan'", () => {
        setAllocMode("auto");
        setStep(5);
        return document.getElementById("wzNextBtn").textContent.trim() === "Wylicz plan";
    });
    check("footer: błąd planu -> etykieta wraca do 'Wylicz plan'", async () => {
        setStep(6);
        await runPlan();
        return document.getElementById("wzNextBtn").textContent.trim() === "Wylicz plan"
            && wzPlan === null;
    });
    check("footer: krok 6 z planem -> 'Przejdź do symulatora'", () => {
        wzPlan = { input: { stages: [] } };
        setStep(6);
        const ok = document.getElementById("wzNextBtn").textContent.trim() === "Przejdź do symulatora";
        wzPlan = null;
        return ok;
    });

    // ---- Krok 6: klik scenariusza odświeża CAŁY wynik (hero, metryki, solved, ostrzeżenia, osie) ----
    const norm = (el) => (el?.textContent || "").replace(/\\s+/g, " ");
    const digits = (txt) => String(txt).replace(/ /g, "");
    const mkStage = (name, type, start, end) => ({ name, stage_type: type, start_age: start, end_age: end, accounts: {} });
    const scenInput = (label) => ({
        stages: [
            mkStage("Akumulacja do emerytury", "akumulacja", 40, 50),
            mkStage("Realizacja " + label, "realizacja", 50, 85),
        ],
    });
    const scenProj = (mean, min, met, label, stageName) => ({
        mean_monthly: mean,
        min_monthly: min,
        target_monthly: 6000,
        met,
        peak_wealth: 100000,
        final_wealth: 0,
        exhaust_age: met ? null : 72,
        warnings: met ? [] : ["W scenariuszu " + label + " kapitał wyczerpuje się przed horyzontem."],
        stage_metrics: [
            { name: "Akumulacja do emerytury", stage_type: "akumulacja", start_age: 40, end_age: 50, monthly: 1200 },
            { name: stageName, stage_type: "realizacja", start_age: 50, end_age: 85, monthly: mean },
        ],
    });
    const scenSolved = (feasible, savings, pct, label) => ({
        feasible,
        savings_monthly: savings,
        savings_pct: pct,
        retire_early_age: null,
        note: feasible ? "" : "W scenariuszu " + label + " cel jest nieosiągalny.",
    });
    const scenarioPlan = {
        path: 2,
        input: scenInput("bazowa"),
        projection: scenProj(5102, 5000, true, "realna", "Realizacja bazowa"),
        solved: scenSolved(true, 7821, 65, "realna"),
        scenarios: {
            konserwatywne: {
                assumptions: "konserwatywne", label: "Kryzys / ostrożne", feasible: false,
                payout_monthly: 6000, savings_monthly: 15744, savings_pct: 131,
                retire_early_age: null, peak_wealth: 10000, final_wealth: 0,
            },
            realne: {
                assumptions: "realne", label: "Realne (bazowe)", feasible: true,
                payout_monthly: 6000, savings_monthly: 7821, savings_pct: 65,
                retire_early_age: null, peak_wealth: 100000, final_wealth: 0,
            },
            optymistyczne: {
                assumptions: "optymistyczne", label: "Hossa / optymistyczne", feasible: true,
                payout_monthly: 6000, savings_monthly: 3847, savings_pct: 32,
                retire_early_age: null, peak_wealth: 300000, final_wealth: 0,
            },
        },
        scenario_inputs: {
            konserwatywne: scenInput("konserwatywna"),
            realne: scenInput("realna"),
            optymistyczne: scenInput("optymistyczna"),
        },
        scenario_projections: {
            konserwatywne: scenProj(4800, 4000, false, "konserwatywnym", "Realizacja konserwatywna"),
            realne: scenProj(5102, 5000, true, "realnym", "Realizacja realna"),
            optymistyczne: scenProj(5600, 5400, true, "optymistycznym", "Realizacja optymistyczna"),
        },
        scenario_solved: {
            konserwatywne: scenSolved(false, 15744, 131, "konserwatywnym"),
            realne: scenSolved(true, 7821, 65, "realnym"),
            optymistyczne: scenSolved(true, 3847, 32, "optymistycznym"),
        },
    };
    wzPlan = scenarioPlan;
    wzSelectedScenario = "realne";
    setStep(6);
    renderScenarios(scenarioPlan);
    renderScenarioResult(scenarioPlan);
    check("krok 6: 3 karty scenariuszy, wybrana = Realne", () => {
        const cards = document.querySelectorAll("#wzScenariosBox .wz-scenario-card");
        const sel = document.querySelector('#wzScenariosBox .wz-scenario-card[data-scenario="realne"]');
        return cards.length === 3
            && sel?.classList.contains("is-selected")
            && sel?.getAttribute("aria-pressed") === "true"
            && !document.querySelector("#wzHeroAnswer")?.classList.contains("is-warn")
            && document.getElementById("wzWarnings")?.classList.contains("hidden") === true;
    });
    check("krok 6: klik scenariusza kryzysowego odświeża hero, metryki, solved i ostrzeżenia", () => {
        document.querySelector('#wzScenariosBox .wz-scenario-card[data-scenario="konserwatywne"]').click();
        const hero = norm(document.getElementById("wzHeroAnswer"));
        const metrics = norm(document.getElementById("wzMetrics"));
        const solved = norm(document.getElementById("wzSolved"));
        const warn = document.getElementById("wzWarnings");
        const selected = document.querySelector('#wzScenariosBox .wz-scenario-card[data-scenario="konserwatywne"]');
        return hero.includes("wymaga korekty")
            && hero.includes("konserwatywnym")
            && digits(metrics).includes("4800")
            && digits(metrics).includes("4000")
            && metrics.includes("✖ nieosiągnięty")
            && digits(solved).includes("15744")
            && solved.includes("nieosiągalny")
            && !warn.classList.contains("hidden")
            && warn.textContent.includes("wyczerpuje się")
            && document.getElementById("wzHeroAnswer").classList.contains("is-warn")
            && selected.classList.contains("is-selected")
            && selected.getAttribute("aria-pressed") === "true";
    });
    check("krok 6: klik scenariusza zmienia oś czasu, etapy i ich średnie kwoty", () => {
        const timeline = norm(document.getElementById("wzTimeline"));
        const stages = norm(document.getElementById("wzStageSummaryList"));
        const finance = document.querySelectorAll("#wzStageSummaryList .stage-finance");
        return timeline.includes("Realizacja konserwatywna")
            && stages.includes("Realizacja konserwatywna")
            && finance.length === 2
            && digits(stages).includes("1200")
            && digits(stages).includes("4800");
    });
    check("krok 6: powrót do scenariusza optymistycznego czyści ostrzeżenia i is-warn", () => {
        document.querySelector('#wzScenariosBox .wz-scenario-card[data-scenario="optymistyczne"]').click();
        const hero = norm(document.getElementById("wzHeroAnswer"));
        const metrics = norm(document.getElementById("wzMetrics"));
        return digits(hero).includes("3847")
            && !hero.includes("wymaga korekty")
            && digits(metrics).includes("5600")
            && !document.getElementById("wzHeroAnswer").classList.contains("is-warn")
            && document.getElementById("wzWarnings").classList.contains("hidden")
            && norm(document.getElementById("wzTimeline")).includes("Realizacja optymistyczna")
            && digits(norm(document.getElementById("wzStageSummaryList"))).includes("5600");
    });
    const phaseProjection = {
        phase_metrics: [
            { key: "accumulation", name: "Akumulacja do emerytury", cashflow: "contribution", start_age: 40, end_age: 50, monthly: 1200, portfolio_monthly: 0, zus_monthly: 0 },
            { key: "bridge", name: "Brydż do emerytury", cashflow: "payout", start_age: 50, end_age: 65, monthly: 3000, portfolio_monthly: 3000, zus_monthly: 0 },
            { key: "retirement_topup", name: "Emerytura + dopłata", cashflow: "payout", start_age: 65, end_age: 77, monthly: 5000, portfolio_monthly: 2000, zus_monthly: 3000 },
            { key: "zus_only", name: "Sama emerytura ZUS", cashflow: "payout", start_age: 77, end_age: 100, monthly: 3500, portfolio_monthly: 0, zus_monthly: 3500 },
        ],
    };
    renderTimeline({ stages: [] }, phaseProjection);
    renderPhaseTable(phaseProjection);
    check("krok 6: faza emerytury dzieli się na dopłatę i samą emeryturę ZUS", () => {
        const segments = [...document.querySelectorAll("#wzTimeline .wz-timeline-segment")];
        const timeline = norm(document.getElementById("wzTimeline"));
        const table = norm(document.getElementById("wzPhaseTable"));
        const rows = document.querySelectorAll("#wzPhaseTable tbody tr");
        const flat = (text) => String(text).replace(/\\s/g, "");
        return segments.length === 4
            && timeline.includes("Emerytura + dopłata")
            && timeline.includes("Sama emerytura ZUS")
            && flat(timeline).includes("5000zł/mies.")
            && flat(timeline).includes("portfel2000+ZUS3000")
            && rows.length === 4
            && table.includes("Składniki")
            && flat(table).includes("portfel2000+ZUS3000")
            && table.includes("szacunek z coroczną waloryzacją");
    });
    wzPlan = null;
    wzSelectedScenario = "realne";

    // ---- Notatka o wypłatach netto w bloku wyniku (krok 6) ----
    check("notatka o wypłatach netto w bloku wyniku, brak #wzStagePreview", () => {
        setStep(6);
        const note = document.querySelector('.wz-step[data-step="6"] .wz-result-note');
        return !!note
            && note.textContent.includes("netto")
            && document.getElementById("wzStagePreview") === null;
    });

    // ---- migracja starego localStorage (tylko wagi) na kwoty roczne ----
    check("restore: stary stan bez amounts migruje wagi na kwoty roczne (ścieżka 1)", () => {
        localStorage.setItem("fire.wizardState", JSON.stringify({
            step: 5,
            path: 1,
            answers: {
                gender: "m",
                age_now: 40,
                employment: "etat",
                gross_monthly: 8000,
                salary_mode: "gross",
                savings: 2000,
                capital: {},
                retire_early_age: 50,
                retirement_age: 65,
                plan_end_age: 85,
            },
            capitalSelected: [],
            pills: ["broker", "lokata"],
            weights: { broker: 25, lokata: 25 },
            allocMode: "manual",
            strategy: "manualna",
            assumptions: "realne",
        }));
        window.history.replaceState({}, "", "/wizard?restore=1");
        const ok = restoreWizardStateIfRequested();
        return ok
            && Math.round(wzAmounts["broker"]) === 6000
            && Math.round(wzAmounts["lokata"]) === 6000
            && Math.round(wzWeights["broker"]) === 25
            && Math.round(wzWeights["lokata"]) === 25
            && document.getElementById("wzAllocCashAnnual").textContent === zl(12000) + " zł/rok";
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

window.eval(scripts + "\n;\n" + harness);

setTimeout(() => {
    if (window.__fireFailed) process.exit(1);
    process.exit(0);
}, 500);
